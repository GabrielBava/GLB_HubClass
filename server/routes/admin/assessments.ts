import { and, asc, count, desc, eq, ilike, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ASSESSMENT_KINDS, FEEDBACK_MODES, PUBLICATION_STATUS, QUESTION_TYPES, userCode } from "../../../shared/domain.js";
import { assertCanManageArea, canManageArea } from "../../authz/policy.js";
import { answers, assessments, attempts, knowledgeAreas, modules, questions, tracks, users } from "../../db/schema.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";
import { checkDefinition, questionDefinition } from "../../services/grading.js";
import { notifyMany } from "../../services/notifications.js";
import { recordRevision } from "../../services/revisions.js";
import { managerContext } from "../../services/scope.js";
import { enrollments } from "../../db/schema.js";

const idParams = z.object({ id: z.string().uuid() });

export async function adminAssessmentRoutes(app: FastifyInstance) {
  const { db, settings } = app.ctx;

  async function assessmentWithTrack(id: string) {
    const [row] = await db.select({ a: assessments, t: tracks }).from(assessments).innerJoin(tracks, eq(tracks.id, assessments.trackId)).where(eq(assessments.id, id));
    if (!row) throw notFound("Avaliação não encontrada.");
    return row;
  }

  const assessmentBody = z.object({
    trackId: z.string().uuid(),
    moduleId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).default(""),
    kind: z.enum(ASSESSMENT_KINDS).default("fixation"),
    passingScore: z.number().int().min(0).max(100).optional(),
    maxAttempts: z.number().int().min(1).max(50).nullable().optional(),
    timeLimitMinutes: z.number().int().min(1).max(600).nullable().optional(),
    questionCount: z.number().int().min(1).max(200).nullable().optional(),
    shuffleQuestions: z.boolean().default(true),
    feedbackMode: z.enum(FEEDBACK_MODES).default("after_submit"),
    isRequired: z.boolean().default(true),
    requiresPassToAdvance: z.boolean().default(true),
    requiresLeaderValidation: z.boolean().default(false),
  });

  app.post("/api/admin/assessments", async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(assessmentBody, req.body);
    const [track] = await db.select().from(tracks).where(eq(tracks.id, body.trackId));
    if (!track) throw notFound("Trilha não encontrada.");
    assertCanManageArea(scope, track.areaId, "edit");
    if (body.moduleId) {
      const [m] = await db.select().from(modules).where(and(eq(modules.id, body.moduleId), eq(modules.trackId, body.trackId)));
      if (!m) throw badRequest("Módulo não pertence à trilha.");
    }
    const [area] = await db.select().from(knowledgeAreas).where(eq(knowledgeAreas.id, track.areaId));
    const defaults = await settings.get("assessment");
    const [row] = await db
      .insert(assessments)
      .values({
        ...body,
        moduleId: body.moduleId ?? null,
        passingScore: body.passingScore ?? area?.settings.passingScore ?? defaults.defaultPassingScore,
        maxAttempts: body.maxAttempts === undefined ? defaults.defaultMaxAttempts : body.maxAttempts,
        createdBy: user.id,
        status: "draft",
      })
      .returning();
    await recordRevision(db, "assessment", row!.id, "created", row!, user.id);
    await audit(req, "assessment.created", { targetType: "assessment", targetId: row!.id });
    return row;
  });

  app.get("/api/admin/assessments/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { a, t } = await assessmentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "view");
    const qs = await db.select().from(questions).where(eq(questions.assessmentId, id)).orderBy(asc(questions.sortOrder), asc(questions.createdAt));
    const mods = await db.select({ id: modules.id, title: modules.title }).from(modules).where(eq(modules.trackId, t.id)).orderBy(asc(modules.sortOrder));
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(attempts).where(eq(attempts.assessmentId, id));
    return {
      assessment: a,
      track: { id: t.id, title: t.title, areaId: t.areaId },
      modules: mods,
      questions: qs,
      attemptsCount: Number(n),
      permissions: { canEdit: canManageArea(scope, t.areaId, "edit"), canPublish: canManageArea(scope, t.areaId, "publish") },
    };
  });

  app.patch("/api/admin/assessments/:id", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const body = parse(assessmentBody.partial().omit({ trackId: true }), req.body);
    const { t } = await assessmentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "edit");
    const [row] = await db.update(assessments).set({ ...body, updatedAt: new Date() }).where(eq(assessments.id, id)).returning();
    await recordRevision(db, "assessment", id, "updated", row!, user.id);
    await audit(req, "assessment.updated", { targetType: "assessment", targetId: id, metadata: { fields: Object.keys(body) } });
    return row;
  });

  app.post("/api/admin/assessments/:id/status", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { status } = parse(z.object({ status: z.enum(PUBLICATION_STATUS) }), req.body);
    const { a, t } = await assessmentWithTrack(id);
    assertCanManageArea(scope, t.areaId, status === "published" || a.status === "published" ? "publish" : "edit");
    if (status === "published") {
      const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(questions).where(and(eq(questions.assessmentId, id), eq(questions.isActive, true)));
      if (Number(n) === 0) throw badRequest("Inclua questões antes de publicar a avaliação.");
    }
    const [row] = await db.update(assessments).set({ status, updatedAt: new Date() }).where(eq(assessments.id, id)).returning();
    await recordRevision(db, "assessment", id, `status:${status}`, row!, user.id);
    await audit(req, "assessment.status_changed", { targetType: "assessment", targetId: id, metadata: { from: a.status, to: status } });
    if (status === "published" && a.status !== "published" && t.status === "published") {
      const enrolled = await db.select({ userId: enrollments.userId }).from(enrollments).where(eq(enrollments.trackId, t.id));
      await notifyMany(app.ctx, enrolled.map((e) => e.userId), {
        type: "assessment_available",
        title: "Avaliação liberada",
        body: `“${a.title}” está disponível na trilha “${t.title}”.`,
        link: `/avaliacoes/${id}`,
        dedupeKey: `assessment:${id}`,
      });
    }
    return row;
  });

  app.delete("/api/admin/assessments/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { a, t } = await assessmentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "publish");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(attempts).where(eq(attempts.assessmentId, id));
    if (Number(n) > 0) throw badRequest("A avaliação já tem tentativas registradas. Arquive para preservar o histórico.");
    await db.delete(assessments).where(eq(assessments.id, id));
    await audit(req, "assessment.deleted", { targetType: "assessment", targetId: id, metadata: { title: a.title } });
    return { ok: true };
  });

  // ------------------------------------------------------------------ Questões
  const questionBody = z.object({
    prompt: z.string().trim().min(3, "Escreva o enunciado.").max(5000),
    context: z.string().trim().max(10_000).default(""),
    explanation: z.string().trim().max(5000).default(""),
    points: z.number().int().min(1).max(100).default(1),
  });

  function parseDefinition(input: unknown) {
    const def = parse(questionDefinition, input);
    const problem = checkDefinition(def);
    if (problem) throw badRequest(problem);
    return def;
  }

  app.post("/api/admin/assessments/:id/questions", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { t } = await assessmentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "edit");
    const base = parse(questionBody, req.body);
    const def = parseDefinition(req.body);
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(questions).where(eq(questions.assessmentId, id));
    const [row] = await db
      .insert(questions)
      .values({
        assessmentId: id,
        type: def.type,
        options: def.options as Record<string, unknown>,
        answerKey: def.answerKey as Record<string, unknown>,
        ...base,
        sortOrder: Number(n),
      })
      .returning();
    await audit(req, "question.created", { targetType: "question", targetId: row!.id, metadata: { assessment: id, by: user.id } });
    return row;
  });

  async function questionWithArea(id: string) {
    const [row] = await db
      .select({ q: questions, areaId: tracks.areaId, assessmentId: assessments.id })
      .from(questions)
      .innerJoin(assessments, eq(assessments.id, questions.assessmentId))
      .innerJoin(tracks, eq(tracks.id, assessments.trackId))
      .where(eq(questions.id, id));
    if (!row) throw notFound("Questão não encontrada.");
    return row;
  }

  app.patch("/api/admin/questions/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const row = await questionWithArea(id);
    assertCanManageArea(scope, row.areaId, "edit");
    const base = parse(questionBody.partial().extend({ isActive: z.boolean().optional() }), req.body);
    const body = req.body as Record<string, unknown>;
    const def = body.type ? parseDefinition(body) : null;
    if (def && def.type !== row.q.type) {
      const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(answers).where(eq(answers.questionId, id));
      if (Number(n) > 0) throw badRequest("Não é possível mudar o tipo de uma questão já respondida. Crie uma nova questão.");
    }
    const [updated] = await db
      .update(questions)
      .set({
        ...base,
        ...(def ? { type: def.type, options: def.options as Record<string, unknown>, answerKey: def.answerKey as Record<string, unknown> } : {}),
        updatedAt: new Date(),
      })
      .where(eq(questions.id, id))
      .returning();
    await audit(req, "question.updated", { targetType: "question", targetId: id });
    return updated;
  });

  app.delete("/api/admin/questions/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const row = await questionWithArea(id);
    assertCanManageArea(scope, row.areaId, "edit");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(answers).where(eq(answers.questionId, id));
    if (Number(n) > 0) {
      // Questões já respondidas são desativadas (o histórico das tentativas é preservado).
      await db.update(questions).set({ isActive: false, updatedAt: new Date() }).where(eq(questions.id, id));
      return { ok: true, deactivated: true };
    }
    await db.delete(questions).where(eq(questions.id, id));
    await audit(req, "question.deleted", { targetType: "question", targetId: id });
    return { ok: true, deactivated: false };
  });

  app.post("/api/admin/assessments/:id/questions/reorder", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { t } = await assessmentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "edit");
    const { ids } = parse(z.object({ ids: z.array(z.string().uuid()).max(500) }), req.body);
    for (const [i, qid] of ids.entries()) await db.update(questions).set({ sortOrder: i }).where(and(eq(questions.id, qid), eq(questions.assessmentId, id)));
    return { ok: true };
  });

  /** Banco de questões: todas as questões das áreas sob responsabilidade do usuário. */
  app.get("/api/admin/questions", async (req) => {
    const { scope } = await managerContext(req);
    const q = parse(z.object({ areaId: z.string().uuid().optional(), type: z.enum(QUESTION_TYPES).optional(), q: z.string().max(100).optional() }), req.query);
    const conds = [eq(questions.isActive, true)];
    if (q.areaId) conds.push(eq(tracks.areaId, q.areaId));
    if (q.type) conds.push(eq(questions.type, q.type));
    if (q.q?.trim()) conds.push(ilike(questions.prompt, `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
    const rows = await db
      .select({ q: questions, assessmentTitle: assessments.title, trackTitle: tracks.title, areaId: tracks.areaId, areaName: knowledgeAreas.name })
      .from(questions)
      .innerJoin(assessments, eq(assessments.id, questions.assessmentId))
      .innerJoin(tracks, eq(tracks.id, assessments.trackId))
      .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
      .where(and(...conds))
      .orderBy(asc(knowledgeAreas.name), asc(tracks.title))
      .limit(500);
    return rows
      .filter((r) => canManageArea(scope, r.areaId, "view"))
      .map((r) => ({ id: r.q.id, type: r.q.type, prompt: r.q.prompt, points: r.q.points, assessmentTitle: r.assessmentTitle, trackTitle: r.trackTitle, areaName: r.areaName }));
  });

  app.post("/api/admin/questions/:id/copy", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { assessmentId } = parse(z.object({ assessmentId: z.string().uuid() }), req.body);
    const src = await questionWithArea(id);
    assertCanManageArea(scope, src.areaId, "view");
    const { t } = await assessmentWithTrack(assessmentId);
    assertCanManageArea(scope, t.areaId, "edit");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(questions).where(eq(questions.assessmentId, assessmentId));
    const { id: _omit, createdAt: _c, updatedAt: _u, assessmentId: _a, ...rest } = src.q;
    void _omit;
    void _c;
    void _u;
    void _a;
    const [row] = await db.insert(questions).values({ ...rest, assessmentId, sortOrder: Number(n) }).returning();
    return row;
  });

  // ------------------------------------------------------------------ Resultados
  app.get("/api/admin/assessments/:id/results", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { a, t } = await assessmentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "view");
    const rows = await db
      .select({ at: attempts, name: users.name, seq: users.seq, teamId: users.teamId })
      .from(attempts)
      .innerJoin(users, eq(users.id, attempts.userId))
      .where(eq(attempts.assessmentId, id))
      .orderBy(desc(attempts.startedAt));
    // Líderes veem resultados apenas da própria equipe.
    const visible = scope.role === "admin" ? rows : rows.filter((r) => r.teamId && scope.leaderTeamIds.has(r.teamId));
    const graded = visible.filter((r) => r.at.status === "graded");
    const users_ = new Set(visible.map((r) => r.at.userId));
    const qs = await db.select().from(questions).where(eq(questions.assessmentId, id)).orderBy(asc(questions.sortOrder));
    const ans = graded.length ? await db.select().from(answers).where(inArray(answers.attemptId, graded.map((g) => g.at.id))) : [];
    return {
      assessment: { id: a.id, title: a.title, passingScore: a.passingScore },
      stats: {
        attempts: visible.length,
        participants: users_.size,
        averageScore: graded.length ? Math.round((graded.reduce((s, g) => s + (g.at.score ?? 0), 0) / graded.length) * 10) / 10 : null,
        passRate: graded.length ? Math.round((graded.filter((g) => g.at.passed).length / graded.length) * 100) : null,
        attemptsPerParticipant: users_.size ? Math.round((visible.length / users_.size) * 10) / 10 : null,
        pendingReview: visible.filter((r) => r.at.status === "pending_review").length,
      },
      questions: qs.map((q) => {
        const list = ans.filter((x) => x.questionId === q.id && x.isCorrect !== null);
        return { id: q.id, prompt: q.prompt, type: q.type, answered: list.length, correctRate: list.length ? Math.round((list.filter((x) => x.isCorrect).length / list.length) * 100) : null };
      }),
      attempts: visible.map((r) => ({
        id: r.at.id,
        userId: r.at.userId,
        name: r.name,
        code: userCode(r.seq),
        number: r.at.attemptNumber,
        status: r.at.status,
        score: r.at.score,
        passed: r.at.passed,
        submittedAt: r.at.submittedAt,
      })),
    };
  });
}
