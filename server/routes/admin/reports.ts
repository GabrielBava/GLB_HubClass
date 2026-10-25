import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LEARNER_TRACK_STATUS_LABEL, ROLE_LABEL, userCode } from "../../../shared/domain.js";
import {
  answers,
  assessments,
  attempts,
  auditLogs,
  enrollments,
  jobTitles,
  knowledgeAreas,
  practicalActivities,
  practicalSubmissions,
  questions,
  tracks,
  trackValidations,
  users,
} from "../../db/schema.js";
import { toCsv } from "../../lib/csv.js";
import { audit, requireRole } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";

const DAY = 86_400_000;

export async function adminReportRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  app.get("/api/admin/reports/overview", async (req) => {
    requireRole(req, "admin");
    const q = parse(z.object({ from: z.string().date().optional(), to: z.string().date().optional(), areaId: z.string().uuid().optional() }), req.query);
    const to = q.to ? new Date(`${q.to}T23:59:59-03:00`) : new Date();
    const from = q.from ? new Date(`${q.from}T00:00:00-03:00`) : new Date(to.getTime() - 90 * DAY);
    const areaCond = q.areaId ? eq(tracks.areaId, q.areaId) : undefined;

    const [activeUsers] = await db.select({ n: count() }).from(users).where(eq(users.status, "active"));
    const [engaged] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.status, "active"), gte(users.lastActivityAt, new Date(Date.now() - 30 * DAY))));

    const enr = await db
      .select({ e: enrollments, areaId: tracks.areaId, areaName: knowledgeAreas.name, jobTitle: jobTitles.name })
      .from(enrollments)
      .innerJoin(tracks, eq(tracks.id, enrollments.trackId))
      .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
      .innerJoin(users, eq(users.id, enrollments.userId))
      .leftJoin(jobTitles, eq(jobTitles.id, users.jobTitleId))
      .where(areaCond);
    const inPeriod = (d: Date | null) => !!d && d >= from && d <= to;
    const started = enr.filter((x) => x.e.startedAt);
    const stale = started.filter((x) => x.e.status !== "completed" && (!x.e.lastActivityAt || x.e.lastActivityAt.getTime() < Date.now() - 30 * DAY));
    const completed = enr.filter((x) => x.e.completedAt && x.e.startedAt);

    const months: { month: string; started: number; completed: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      months.push({
        month: key,
        started: enr.filter((x) => x.e.startedAt?.toISOString().slice(0, 7) === key).length,
        completed: enr.filter((x) => x.e.completedAt?.toISOString().slice(0, 7) === key).length,
      });
    }

    // Aprendizado
    const att = await db
      .select({ a: attempts, title: assessments.title, trackTitle: tracks.title })
      .from(attempts)
      .innerJoin(assessments, eq(assessments.id, attempts.assessmentId))
      .innerJoin(tracks, eq(tracks.id, assessments.trackId))
      .where(and(areaCond, isNotNull(attempts.submittedAt), gte(attempts.submittedAt, from), lte(attempts.submittedAt, to)));
    const graded = att.filter((x) => x.a.status === "graded");
    const pairs = new Map<string, number>();
    for (const x of att) pairs.set(`${x.a.userId}:${x.a.assessmentId}`, (pairs.get(`${x.a.userId}:${x.a.assessmentId}`) ?? 0) + 1);
    const byAssessment = new Map<string, { title: string; trackTitle: string; total: number; passed: number }>();
    for (const x of graded) {
      const cur = byAssessment.get(x.a.assessmentId) ?? { title: x.title, trackTitle: x.trackTitle, total: 0, passed: 0 };
      cur.total++;
      if (x.a.passed) cur.passed++;
      byAssessment.set(x.a.assessmentId, cur);
    }
    const hardestAssessments = [...byAssessment.entries()]
      .filter(([, v]) => v.total >= 3)
      .map(([id, v]) => ({ id, title: v.title, trackTitle: v.trackTitle, attempts: v.total, passRate: Math.round((v.passed / v.total) * 100) }))
      .sort((a, b) => a.passRate - b.passRate)
      .slice(0, 5);
    const qStats = graded.length
      ? await db
          .select({
            questionId: answers.questionId,
            prompt: questions.prompt,
            total: sql<number>`count(*)::int`,
            correct: sql<number>`count(*) filter (where ${answers.isCorrect})::int`,
          })
          .from(answers)
          .innerJoin(questions, eq(questions.id, answers.questionId))
          .where(and(inArray(answers.attemptId, graded.map((g) => g.a.id)), isNotNull(answers.isCorrect)))
          .groupBy(answers.questionId, questions.prompt)
      : [];
    const hardestQuestions = qStats
      .filter((s) => s.total >= 3)
      .map((s) => ({ id: s.questionId, prompt: s.prompt.slice(0, 160), answers: s.total, correctRate: Math.round((s.correct / s.total) * 100) }))
      .sort((a, b) => a.correctRate - b.correctRate)
      .slice(0, 5);
    const [pendingSubs] = await db.select({ n: count() }).from(practicalSubmissions).where(eq(practicalSubmissions.status, "submitted"));
    const [pendingReviews] = await db.select({ n: count() }).from(attempts).where(eq(attempts.status, "pending_review"));

    // Desenvolvimento
    const subs = await db
      .select({ s: practicalSubmissions, stage: practicalActivities.stage })
      .from(practicalSubmissions)
      .innerJoin(practicalActivities, eq(practicalActivities.id, practicalSubmissions.activityId))
      .innerJoin(tracks, eq(tracks.id, practicalActivities.trackId))
      .where(and(areaCond, eq(practicalSubmissions.status, "approved")));
    const [validations] = await db.select({ n: count() }).from(trackValidations).where(eq(trackValidations.decision, "approved"));
    const daysToComplete = completed.map((x) => (x.e.completedAt!.getTime() - x.e.startedAt!.getTime()) / DAY);
    const firstStart = new Map<string, number>();
    for (const x of started) {
      const t = x.e.startedAt!.getTime();
      if (!firstStart.has(x.e.userId) || t < firstStart.get(x.e.userId)!) firstStart.set(x.e.userId, t);
    }
    const firstExecution = new Map<string, number>();
    for (const x of subs) {
      if (x.stage !== "execute" || !x.s.reviewedAt) continue;
      const t = x.s.reviewedAt.getTime();
      if (!firstExecution.has(x.s.userId) || t < firstExecution.get(x.s.userId)!) firstExecution.set(x.s.userId, t);
    }
    const daysToExecution = [...firstExecution.entries()].filter(([u]) => firstStart.has(u)).map(([u, t]) => (t - firstStart.get(u)!) / DAY);
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

    const groupBy = (key: (x: (typeof enr)[number]) => string) => {
      const map = new Map<string, { enrollments: number; completed: number; percentSum: number }>();
      for (const x of enr) {
        const k = key(x);
        const cur = map.get(k) ?? { enrollments: 0, completed: 0, percentSum: 0 };
        cur.enrollments++;
        cur.percentSum += x.e.progressPercent;
        if (x.e.status === "completed") cur.completed++;
        map.set(k, cur);
      }
      return [...map.entries()]
        .map(([name, v]) => ({ name, enrollments: v.enrollments, completed: v.completed, avgPercent: Math.round(v.percentSum / v.enrollments) }))
        .sort((a, b) => b.enrollments - a.enrollments);
    };

    return {
      period: { from, to },
      engagement: {
        activeUsers: Number(activeUsers?.n ?? 0),
        engagedLast30Days: Number(engaged?.n ?? 0),
        tracksStarted: started.filter((x) => inPeriod(x.e.startedAt)).length,
        tracksCompleted: completed.filter((x) => inPeriod(x.e.completedAt)).length,
        abandonmentRate: started.length ? Math.round((stale.length / started.length) * 100) : null,
        evolution: months,
      },
      learning: {
        averageScore: graded.length ? Math.round((graded.reduce((s, g) => s + (g.a.score ?? 0), 0) / graded.length) * 10) / 10 : null,
        passRate: graded.length ? Math.round((graded.filter((g) => g.a.passed).length / graded.length) * 100) : null,
        attemptsPerAssessment: pairs.size ? Math.round(([...pairs.values()].reduce((s, n) => s + n, 0) / pairs.size) * 10) / 10 : null,
        hardestAssessments,
        hardestQuestions,
        pendingValidations: Number(pendingSubs?.n ?? 0) + Number(pendingReviews?.n ?? 0),
      },
      development: {
        competenciesDemonstrated: subs.filter((x) => x.stage === "demonstrate").length,
        practiceValidated: subs.filter((x) => x.stage === "execute").length + Number(validations?.n ?? 0),
        avgDaysToComplete: avg(daysToComplete),
        avgDaysToFirstSupervisedExecution: avg(daysToExecution),
        byJobTitle: groupBy((x) => x.jobTitle ?? "Sem cargo"),
        byArea: groupBy((x) => x.areaName),
      },
      commercial: {
        available: false,
        note: "Integração com CRM prevista para a Fase 3. Indicadores comerciais mostram correlação, não causalidade.",
      },
    };
  });

  app.get("/api/admin/reports/export.csv", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    requireRole(req, "admin");
    const { type } = parse(z.object({ type: z.enum(["enrollments", "attempts", "users"]) }), req.query);
    let csv = "";
    if (type === "enrollments") {
      const rows = await db
        .select({ e: enrollments, u: users, t: tracks, areaName: knowledgeAreas.name })
        .from(enrollments)
        .innerJoin(users, eq(users.id, enrollments.userId))
        .innerJoin(tracks, eq(tracks.id, enrollments.trackId))
        .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
        .orderBy(asc(users.name));
      csv = toCsv(
        ["Colaborador", "Identificador", "Área", "Trilha", "Status", "Progresso (%)", "Origem", "Obrigatória", "Prazo", "Início", "Conclusão"],
        rows.map(({ e, u, t, areaName }) => [
          u.name,
          userCode(u.seq),
          areaName,
          t.title,
          LEARNER_TRACK_STATUS_LABEL[e.status],
          e.progressPercent,
          e.source,
          e.isMandatory || t.mode === "obrigatoria" ? "Sim" : "Não",
          e.dueDate?.toISOString().slice(0, 10) ?? "",
          e.startedAt?.toISOString().slice(0, 10) ?? "",
          e.completedAt?.toISOString().slice(0, 10) ?? "",
        ]),
      );
    } else if (type === "attempts") {
      const rows = await db
        .select({ a: attempts, u: users, title: assessments.title, trackTitle: tracks.title })
        .from(attempts)
        .innerJoin(users, eq(users.id, attempts.userId))
        .innerJoin(assessments, eq(assessments.id, attempts.assessmentId))
        .innerJoin(tracks, eq(tracks.id, assessments.trackId))
        .orderBy(desc(attempts.startedAt));
      csv = toCsv(
        ["Colaborador", "Identificador", "Trilha", "Avaliação", "Tentativa", "Status", "Nota (%)", "Aprovado", "Enviada em"],
        rows.map(({ a, u, title, trackTitle }) => [u.name, userCode(u.seq), trackTitle, title, a.attemptNumber, a.status, a.score ?? "", a.passed === null ? "" : a.passed ? "Sim" : "Não", a.submittedAt ?? ""]),
      );
    } else {
      const rows = await db
        .select({ u: users, jobTitle: jobTitles.name })
        .from(users)
        .leftJoin(jobTitles, eq(jobTitles.id, users.jobTitleId))
        .orderBy(asc(users.name));
      csv = toCsv(
        ["Nome", "Identificador", "E-mail", "Perfil", "Status", "Cargo", "MFA", "Último login"],
        rows.map(({ u, jobTitle }) => [u.name, userCode(u.seq), u.email, ROLE_LABEL[u.role], u.status, jobTitle ?? "", u.mfaEnabled ? "Sim" : "Não", u.lastLoginAt ?? ""]),
      );
    }
    await audit(req, "report.exported", { metadata: { kind: type } });
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="lifeclass-${type}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

  // ------------------------------------------------------------------ Auditoria
  const auditQuery = z.object({
    action: z.string().max(80).optional(),
    actor: z.string().max(120).optional(),
    outcome: z.enum(["success", "failure", "denied"]).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  });

  function auditConds(q: z.infer<typeof auditQuery>) {
    const conds = [];
    if (q.action) conds.push(ilike(auditLogs.action, `${q.action.replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
    if (q.actor) conds.push(ilike(auditLogs.actorEmail, `%${q.actor.replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
    if (q.outcome) conds.push(eq(auditLogs.outcome, q.outcome));
    if (q.from) conds.push(gte(auditLogs.at, new Date(`${q.from}T00:00:00-03:00`)));
    if (q.to) conds.push(lte(auditLogs.at, new Date(`${q.to}T23:59:59-03:00`)));
    return conds.length ? and(...conds) : undefined;
  }

  app.get("/api/admin/audit", async (req) => {
    requireRole(req, "admin");
    const q = parse(auditQuery, req.query);
    const pageSize = 50;
    const where = auditConds(q);
    const rows = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.at)).limit(pageSize).offset((q.page - 1) * pageSize);
    const [total] = await db.select({ n: count() }).from(auditLogs).where(where);
    return { items: rows, total: Number(total?.n ?? 0), page: q.page, pageSize };
  });

  app.get("/api/admin/audit.csv", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    requireRole(req, "admin");
    const q = parse(auditQuery, req.query);
    const rows = await db.select().from(auditLogs).where(auditConds(q)).orderBy(desc(auditLogs.at)).limit(50_000);
    await audit(req, "audit.exported", { metadata: { rows: rows.length } });
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="auditoria-${new Date().toISOString().slice(0, 10)}.csv"`);
    return toCsv(
      ["Data", "Ação", "Resultado", "Usuário", "Alvo", "ID do alvo", "IP", "Detalhes"],
      rows.map((r) => [r.at, r.action, r.outcome, r.actorEmail ?? "", r.targetType ?? "", r.targetId ?? "", r.ip ?? "", JSON.stringify(r.metadata)]),
    );
  });
}
