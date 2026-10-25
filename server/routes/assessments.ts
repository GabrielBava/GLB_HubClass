import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { answers, assessments, attempts, questions } from "../db/schema.js";
import type { DB } from "../db/client.js";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.js";
import { audit, currentUser } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { requireTerms, trackForUser } from "../services/access.js";
import { answerKeyForFeedback, gradeResponse, orderQuestions, parseResponse, sanitizeQuestion } from "../services/grading.js";
import { notify } from "../services/notifications.js";
import { refreshEnrollment } from "../services/progress.js";

const idParams = z.object({ id: z.string().uuid() });
const GRACE_MS = 30_000;

type Attempt = typeof attempts.$inferSelect;
type Assessment = typeof assessments.$inferSelect;

/** Corrige e encerra uma tentativa. Discursivas (ou validação do líder) ficam pendentes de revisão. */
export async function finalizeAttempt(app: FastifyInstance, attempt: Attempt, assessment: Assessment) {
  const { db } = app.ctx;
  const qs = attempt.questionIds.length ? await db.select().from(questions).where(inArray(questions.id, attempt.questionIds)) : [];
  const saved = await db.select().from(answers).where(eq(answers.attemptId, attempt.id));
  const byQ = new Map(saved.map((a) => [a.questionId, a]));
  let total = 0;
  let got = 0;
  let pending = false;
  for (const q of qs) {
    const a = byQ.get(q.id);
    const g = gradeResponse(q, a?.response ?? null);
    total += q.points;
    if (g.points === null) pending = true;
    else got += g.points;
    await db
      .insert(answers)
      .values({ attemptId: attempt.id, questionId: q.id, response: a?.response ?? null, isCorrect: g.isCorrect, pointsAwarded: g.points, maxPoints: q.points })
      .onConflictDoUpdate({ target: [answers.attemptId, answers.questionId], set: { isCorrect: g.isCorrect, pointsAwarded: g.points, maxPoints: q.points } });
  }
  const needsReview = pending || assessment.requiresLeaderValidation;
  const score = total ? Math.round((got / total) * 1000) / 10 : 0;
  const [updated] = await db
    .update(attempts)
    .set({
      status: needsReview ? "pending_review" : "graded",
      submittedAt: new Date(),
      score: needsReview ? null : score,
      passed: needsReview ? null : score >= assessment.passingScore,
      gradedAt: needsReview ? null : new Date(),
    })
    .where(and(eq(attempts.id, attempt.id), eq(attempts.status, "in_progress")))
    .returning();
  if (!updated) return attempt;
  await refreshEnrollment(app.ctx, attempt.userId, assessment.trackId);
  if (!needsReview) {
    await notify(app.ctx, {
      userId: attempt.userId,
      type: "assessment_graded",
      title: updated.passed ? "Avaliação aprovada" : "Resultado da avaliação",
      body: `${assessment.title}: ${score.toLocaleString("pt-BR")}% de aproveitamento.`,
      link: `/avaliacoes/${assessment.id}/tentativas/${attempt.id}`,
      dedupeKey: `graded:${attempt.id}`,
    });
  }
  return updated;
}

async function loadAssessmentFor(req: FastifyRequest, db: DB, assessmentId: string) {
  const [assessment] = await db.select().from(assessments).where(eq(assessments.id, assessmentId));
  if (!assessment) throw notFound("Avaliação não encontrada.");
  const t = await trackForUser(req, assessment.trackId);
  const view =
    t.view.modules.flatMap((m) => m.assessments).find((a) => a.id === assessmentId) ?? t.view.finalAssessments.find((a) => a.id === assessmentId);
  if (!view) {
    if (assessment.status !== "published" && !t.preview) throw notFound("Avaliação não encontrada.");
    await audit(req, "authz.denied", { outcome: "denied", targetType: "assessment", targetId: assessmentId });
    throw forbidden("Você não tem acesso a esta avaliação.", "no_access");
  }
  await requireTerms(req, t.lc.user.id);
  return { assessment, view, t };
}

export async function assessmentRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  async function expireIfNeeded(attempt: Attempt, assessment: Assessment) {
    if (attempt.status === "in_progress" && attempt.expiresAt && attempt.expiresAt.getTime() + GRACE_MS < Date.now()) {
      return finalizeAttempt(app, attempt, assessment);
    }
    return attempt;
  }

  app.get("/api/assessments/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const { assessment, view, t } = await loadAssessmentFor(req, db, id);
    const list = await db
      .select()
      .from(attempts)
      .where(and(eq(attempts.assessmentId, id), eq(attempts.userId, t.lc.user.id)))
      .orderBy(desc(attempts.attemptNumber));
    const [qCount] = [await db.select({ id: questions.id }).from(questions).where(and(eq(questions.assessmentId, id), eq(questions.isActive, true)))];
    const moduleView = t.view.modules.find((m) => m.assessments.some((a) => a.id === id));
    return {
      assessment: {
        id: assessment.id,
        title: assessment.title,
        description: assessment.description,
        kind: assessment.kind,
        passingScore: assessment.passingScore,
        maxAttempts: assessment.maxAttempts,
        timeLimitMinutes: assessment.timeLimitMinutes,
        questionCount: Math.min(assessment.questionCount ?? qCount!.length, qCount!.length),
        feedbackMode: assessment.feedbackMode,
        requiresPassToAdvance: assessment.requiresPassToAdvance,
        requiresLeaderValidation: assessment.requiresLeaderValidation,
      },
      status: view.status,
      locked: view.locked && !t.preview,
      bestScore: view.bestScore,
      attempts: list.map((a) => ({ id: a.id, number: a.attemptNumber, status: a.status, score: a.score, passed: a.passed, startedAt: a.startedAt, submittedAt: a.submittedAt })),
      track: { id: t.structure.track.id, title: t.structure.track.title },
      module: moduleView ? { id: moduleView.id, title: moduleView.title } : null,
    };
  });

  app.post("/api/assessments/:id/attempts", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { assessment, view, t } = await loadAssessmentFor(req, db, id);
    if (view.locked && !t.preview) throw new HttpError(403, "locked", "Conclua os conteúdos obrigatórios do módulo para liberar a avaliação.");
    const userId = t.lc.user.id;
    const list = await db.select().from(attempts).where(and(eq(attempts.assessmentId, id), eq(attempts.userId, userId))).orderBy(asc(attempts.attemptNumber));
    for (const a of list) {
      if (a.status === "in_progress") {
        const current = await expireIfNeeded(a, assessment);
        if (current.status === "in_progress") return { attemptId: current.id, resumed: true };
      }
    }
    if (list.some((a) => a.passed)) throw badRequest("Você já foi aprovado nesta avaliação.");
    if (list.some((a) => a.status === "pending_review")) throw badRequest("Sua tentativa anterior está aguardando correção.");
    if (assessment.maxAttempts !== null && list.length >= assessment.maxAttempts) {
      throw new HttpError(403, "no_attempts", "Você não tem mais tentativas disponíveis. Fale com seu líder.");
    }
    const pool = await db
      .select()
      .from(questions)
      .where(and(eq(questions.assessmentId, id), eq(questions.isActive, true)))
      .orderBy(asc(questions.sortOrder));
    if (!pool.length) throw badRequest("Esta avaliação ainda não tem questões.");
    let selected = pool;
    if (assessment.questionCount && assessment.questionCount < pool.length) {
      const copy = [...pool];
      selected = [];
      while (selected.length < assessment.questionCount) selected.push(copy.splice(randomInt(copy.length), 1)[0]!);
      selected.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    const [attempt] = await db
      .insert(attempts)
      .values({
        assessmentId: id,
        userId,
        attemptNumber: list.length + 1,
        questionIds: selected.map((q) => q.id),
        expiresAt: assessment.timeLimitMinutes ? new Date(Date.now() + assessment.timeLimitMinutes * 60_000) : null,
      })
      .returning();
    await db.insert(answers).values(selected.map((q) => ({ attemptId: attempt!.id, questionId: q.id, maxPoints: q.points })));
    await audit(req, "assessment.started", { targetType: "assessment", targetId: id, metadata: { attempt: attempt!.attemptNumber } });
    await refreshEnrollment(app.ctx, userId, assessment.trackId);
    return { attemptId: attempt!.id, resumed: false };
  });

  async function ownAttempt(req: FastifyRequest, attemptId: string) {
    const user = currentUser(req);
    const [attempt] = await db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.userId, user.id)));
    if (!attempt) throw notFound("Tentativa não encontrada.");
    const [assessment] = await db.select().from(assessments).where(eq(assessments.id, attempt.assessmentId));
    if (!assessment) throw notFound();
    return { attempt: await expireIfNeeded(attempt, assessment), assessment };
  }

  app.get("/api/attempts/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const { attempt, assessment } = await ownAttempt(req, id);
    // O colaborador precisa continuar com acesso à trilha para ver a tentativa.
    await loadAssessmentFor(req, db, assessment.id);
    const qs = attempt.questionIds.length ? await db.select().from(questions).where(inArray(questions.id, attempt.questionIds)) : [];
    const byId = new Map(qs.map((q) => [q.id, q]));
    const ordered = orderQuestions(
      attempt.questionIds.map((qid) => byId.get(qid)).filter((q): q is NonNullable<typeof q> => !!q),
      attempt.id,
      assessment.shuffleQuestions,
    );
    const saved = await db.select().from(answers).where(eq(answers.attemptId, attempt.id));
    const byQ = new Map(saved.map((a) => [a.questionId, a]));
    const done = attempt.status !== "in_progress";
    const showKey = done && attempt.status === "graded" && assessment.feedbackMode === "after_submit";
    const count = await db.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.assessmentId, assessment.id), eq(attempts.userId, attempt.userId)));
    return {
      attempt: {
        id: attempt.id,
        number: attempt.attemptNumber,
        status: attempt.status,
        startedAt: attempt.startedAt,
        expiresAt: attempt.expiresAt,
        submittedAt: attempt.submittedAt,
        score: attempt.score,
        passed: attempt.passed,
        feedback: attempt.feedback,
        serverNow: new Date(),
      },
      assessment: {
        id: assessment.id,
        title: assessment.title,
        passingScore: assessment.passingScore,
        maxAttempts: assessment.maxAttempts,
        feedbackMode: assessment.feedbackMode,
        trackId: assessment.trackId,
        moduleId: assessment.moduleId,
      },
      attemptsUsed: count.length,
      questions: ordered.map((q) => {
        const a = byQ.get(q.id);
        return {
          ...sanitizeQuestion(q, attempt.id, assessment.shuffleQuestions),
          response: a?.response ?? null,
          ...(done
            ? {
                isCorrect: a?.isCorrect ?? null,
                pointsAwarded: a?.pointsAwarded ?? null,
                maxPoints: a?.maxPoints ?? q.points,
                reviewerComment: a?.reviewerComment ?? null,
              }
            : {}),
          ...(showKey ? { answerKey: answerKeyForFeedback(q), explanation: q.explanation } : {}),
        };
      }),
    };
  });

  app.put("/api/attempts/:id/answers", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ questionId: z.string().uuid(), response: z.unknown() }), req.body);
    const { attempt } = await ownAttempt(req, id);
    if (attempt.status !== "in_progress") throw badRequest("Esta tentativa já foi enviada.");
    if (!attempt.questionIds.includes(body.questionId)) throw notFound("Questão não pertence a esta tentativa.");
    const [q] = await db.select().from(questions).where(eq(questions.id, body.questionId));
    if (!q) throw notFound();
    const response = body.response === null ? null : parseResponse(q.type, body.response);
    if (body.response !== null && response === null) throw badRequest("Resposta em formato inválido.");
    await db
      .update(answers)
      .set({ response })
      .where(and(eq(answers.attemptId, id), eq(answers.questionId, body.questionId)));
    return { ok: true };
  });

  app.post("/api/attempts/:id/submit", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({ answers: z.array(z.object({ questionId: z.string().uuid(), response: z.unknown() })).max(200).default([]) }),
      req.body ?? {},
    );
    const { attempt, assessment } = await ownAttempt(req, id);
    if (attempt.status !== "in_progress") return { status: attempt.status, attemptId: attempt.id };
    await loadAssessmentFor(req, db, assessment.id);
    const late = attempt.expiresAt && attempt.expiresAt.getTime() + GRACE_MS < Date.now();
    if (!late) {
      for (const a of body.answers) {
        if (!attempt.questionIds.includes(a.questionId)) continue;
        const [q] = await db.select().from(questions).where(eq(questions.id, a.questionId));
        if (!q) continue;
        const response = a.response === null ? null : parseResponse(q.type, a.response);
        await db.update(answers).set({ response }).where(and(eq(answers.attemptId, id), eq(answers.questionId, a.questionId)));
      }
    }
    const result = await finalizeAttempt(app, attempt, assessment);
    await audit(req, "assessment.submitted", {
      targetType: "assessment",
      targetId: assessment.id,
      metadata: { attempt: attempt.attemptNumber, status: result.status, score: result.score, passed: result.passed },
    });
    return { status: result.status, attemptId: attempt.id, score: result.score, passed: result.passed };
  });
}
