import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACCESS_RESOURCES, FEEDBACK_KINDS, LEARNER_TRACK_STATUS_LABEL, userCode } from "../../shared/domain.js";
import { assertCanManageUser, canManageArea, managedUserIds } from "../authz/policy.js";
import {
  accessRules,
  answers,
  assessments,
  attempts,
  enrollments,
  feedbacks,
  jobTitles,
  knowledgeAreas,
  practicalActivities,
  practicalSubmissions,
  questions,
  requests,
  teams,
  tracks,
  trackValidations,
  users,
} from "../db/schema.js";
import { toCsv } from "../lib/csv.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { computeTrackView, loadTrackStructure, loadUserTrackState } from "../services/learning.js";
import { notify } from "../services/notifications.js";
import { refreshEnrollment } from "../services/progress.js";
import { managerContext, resourceAreaId } from "../services/scope.js";
import { answerKeyForFeedback, sanitizeQuestion } from "../services/grading.js";

const idParams = z.object({ id: z.string().uuid() });

/**
 * Painel do líder. Líderes enxergam apenas colaboradores das equipes que lideram e só
 * gerenciam trilhas das áreas pelas quais respondem; administradores enxergam tudo.
 * Indicadores coletados: progresso, notas, entregas e datas de atividade (sem horários de uso).
 */
export async function leaderRoutes(app: FastifyInstance) {
  const { db, settings } = app.ctx;

  async function memberRows(userIds: string[]) {
    if (!userIds.length) return [];
    return db
      .select({ u: users, jobTitle: jobTitles.name, team: teams.name })
      .from(users)
      .leftJoin(jobTitles, eq(jobTitles.id, users.jobTitleId))
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(and(inArray(users.id, userIds), ne(users.status, "invited")))
      .orderBy(asc(users.name));
  }

  async function teamMetrics(userIds: string[]) {
    const enr = userIds.length
      ? await db
          .select({ e: enrollments, title: tracks.title, mode: tracks.mode, areaId: tracks.areaId })
          .from(enrollments)
          .innerJoin(tracks, eq(tracks.id, enrollments.trackId))
          .where(inArray(enrollments.userId, userIds))
      : [];
    const att = userIds.length
      ? await db
          .select({ userId: attempts.userId, assessmentId: attempts.assessmentId, score: attempts.score, passed: attempts.passed, status: attempts.status })
          .from(attempts)
          .where(inArray(attempts.userId, userIds))
      : [];
    const subs = userIds.length
      ? await db
          .select({ userId: practicalSubmissions.userId, status: practicalSubmissions.status, stage: practicalActivities.stage })
          .from(practicalSubmissions)
          .innerJoin(practicalActivities, eq(practicalActivities.id, practicalSubmissions.activityId))
          .where(inArray(practicalSubmissions.userId, userIds))
      : [];
    const vals = userIds.length
      ? await db.select().from(trackValidations).where(and(inArray(trackValidations.userId, userIds), eq(trackValidations.decision, "approved")))
      : [];
    return { enr, att, subs, vals };
  }

  app.get("/api/leader/overview", async (req) => {
    const { scope } = await managerContext(req);
    const ids = await managedUserIds(db, scope);
    const members = await memberRows(ids);
    const { enr, att, subs, vals } = await teamMetrics(members.map((m) => m.u.id));
    const now = Date.now();

    const list = members.map(({ u, jobTitle, team }) => {
      const mine = enr.filter((x) => x.e.userId === u.id);
      const assigned = mine.filter((x) => x.e.source !== "self" || x.mode === "obrigatoria");
      const overdue = mine.filter((x) => x.e.dueDate && x.e.dueDate.getTime() < now && x.e.status !== "completed");
      const myAttempts = att.filter((a) => a.userId === u.id && a.status === "graded");
      const failedByAssessment = new Map<string, number>();
      for (const a of myAttempts) if (!a.passed) failedByAssessment.set(a.assessmentId, (failedByAssessment.get(a.assessmentId) ?? 0) + 1);
      const reasons: string[] = [];
      if ([...failedByAssessment.values()].some((n) => n >= 2)) reasons.push("Reprovações repetidas em avaliação");
      if (overdue.length) reasons.push("Treinamento com prazo vencido");
      if (mine.some((x) => x.e.status === "needs_revision")) reasons.push("Trilha precisa de revisão");
      const mySubs = subs.filter((s) => s.userId === u.id);
      const scores = myAttempts.map((a) => a.score ?? 0);
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        code: userCode(u.seq),
        jobTitle,
        team,
        status: u.status,
        lastActivityDate: u.lastActivityAt ? u.lastActivityAt.toISOString().slice(0, 10) : null,
        tracks: mine.length,
        assigned: assigned.length,
        completed: mine.filter((x) => x.e.status === "completed").length,
        inProgress: mine.filter((x) => !["completed", "not_started"].includes(x.e.status)).length,
        mandatoryPending: mine.filter((x) => (x.e.isMandatory || x.mode === "obrigatoria") && x.e.status !== "completed").length,
        overdue: overdue.length,
        completionPercent: mine.length ? Math.round(mine.reduce((s, x) => s + x.e.progressPercent, 0) / mine.length) : 0,
        avgScore: scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : null,
        pendingPractical: mySubs.filter((s) => s.status === "submitted").length,
        competenciesValidated: mySubs.filter((s) => s.status === "approved").length + vals.filter((v) => v.userId === u.id).length,
        struggling: reasons.length > 0,
        strugglingReasons: reasons,
      };
    });

    // Evolução coletiva: conclusões por mês (últimos 6 meses).
    const months: { month: string; completed: number; started: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      months.push({
        month: key,
        completed: enr.filter((x) => x.e.completedAt?.toISOString().slice(0, 7) === key).length,
        started: enr.filter((x) => x.e.startedAt?.toISOString().slice(0, 7) === key).length,
      });
    }

    const assignable = await db
      .select({ id: tracks.id, title: tracks.title, areaId: tracks.areaId, areaName: knowledgeAreas.name, status: tracks.status })
      .from(tracks)
      .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
      .where(eq(tracks.status, "published"))
      .orderBy(asc(knowledgeAreas.sortOrder), asc(tracks.title));

    return {
      kpis: {
        members: list.length,
        avgCompletion: list.length ? Math.round(list.reduce((s, m) => s + m.completionPercent, 0) / list.length) : 0,
        mandatoryPending: list.reduce((s, m) => s + m.mandatoryPending, 0),
        overdue: list.reduce((s, m) => s + m.overdue, 0),
        pendingValidations: list.reduce((s, m) => s + m.pendingPractical, 0),
        struggling: list.filter((m) => m.struggling).length,
        competenciesValidated: list.reduce((s, m) => s + m.competenciesValidated, 0),
      },
      members: list,
      evolution: months,
      assignableTracks: assignable.filter((t) => canManageArea(scope, t.areaId, "view")),
      scope: {
        role: scope.role,
        areaIds: [...scope.leaderAreaIds],
        teamIds: [...scope.leaderTeamIds],
      },
    };
  });

  app.get("/api/leader/members/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    await assertCanManageUser(db, scope, id);
    const [m] = await memberRows([id]);
    if (!m) throw notFound("Colaborador não encontrado.");
    const reading = await settings.get("reading");
    const enr = await db
      .select({ e: enrollments, t: tracks, areaName: knowledgeAreas.name })
      .from(enrollments)
      .innerJoin(tracks, eq(tracks.id, enrollments.trackId))
      .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
      .where(eq(enrollments.userId, id))
      .orderBy(desc(enrollments.updatedAt));

    const trackDetails = [];
    for (const { e, t, areaName } of enr) {
      const inScope = canManageArea(scope, t.areaId, "view");
      let pillars = null;
      let validation = null;
      if (inScope) {
        const s = await loadTrackStructure(db, t.id, false);
        if (s) {
          const st = await loadUserTrackState(db, id, s);
          const v = computeTrackView(s, st, { reading });
          pillars = v.pillars;
          validation = v.validation;
        }
      }
      trackDetails.push({
        enrollmentId: e.id,
        trackId: t.id,
        title: t.title,
        areaName,
        inScope,
        status: e.status,
        statusLabel: LEARNER_TRACK_STATUS_LABEL[e.status],
        percent: e.progressPercent,
        source: e.source,
        isMandatory: e.isMandatory || t.mode === "obrigatoria",
        dueDate: e.dueDate,
        startedAt: e.startedAt,
        completedAt: e.completedAt,
        lastActivityDate: e.lastActivityAt ? e.lastActivityAt.toISOString().slice(0, 10) : null,
        requiresLeaderValidation: t.requiresLeaderValidation,
        pillars,
        validation,
      });
    }

    const areaFilter = scope.role === "admin" ? undefined : inArray(tracks.areaId, [...scope.leaderAreaIds, "00000000-0000-0000-0000-000000000000"]);
    const att = await db
      .select({ a: attempts, title: assessments.title, trackTitle: tracks.title })
      .from(attempts)
      .innerJoin(assessments, eq(assessments.id, attempts.assessmentId))
      .innerJoin(tracks, eq(tracks.id, assessments.trackId))
      .where(and(eq(attempts.userId, id), areaFilter))
      .orderBy(desc(attempts.startedAt))
      .limit(50);
    const subs = await db
      .select({ s: practicalSubmissions, title: practicalActivities.title, stage: practicalActivities.stage, competency: practicalActivities.competency, trackTitle: tracks.title })
      .from(practicalSubmissions)
      .innerJoin(practicalActivities, eq(practicalActivities.id, practicalSubmissions.activityId))
      .innerJoin(tracks, eq(tracks.id, practicalActivities.trackId))
      .where(and(eq(practicalSubmissions.userId, id), areaFilter))
      .orderBy(desc(practicalSubmissions.submittedAt))
      .limit(50);
    const fb = await db
      .select({ f: feedbacks, author: users.name })
      .from(feedbacks)
      .leftJoin(users, eq(users.id, feedbacks.authorId))
      .where(eq(feedbacks.userId, id))
      .orderBy(desc(feedbacks.createdAt));
    const rules = await db
      .select()
      .from(accessRules)
      .where(and(eq(accessRules.subjectType, "user"), eq(accessRules.subjectId, id)))
      .orderBy(desc(accessRules.createdAt));
    const ruleDetails = [];
    for (const r of rules) {
      const areaId = await resourceAreaId(db, r.resourceType, r.resourceId);
      if (!areaId || !canManageArea(scope, areaId, "view")) continue;
      ruleDetails.push({ id: r.id, resourceType: r.resourceType, resourceId: r.resourceId, effect: r.effect, note: r.note, createdAt: r.createdAt, title: await resourceTitle(r.resourceType, r.resourceId) });
    }

    return {
      member: {
        id: m.u.id,
        name: m.u.name,
        email: m.u.email,
        code: userCode(m.u.seq),
        jobTitle: m.jobTitle,
        team: m.team,
        status: m.u.status,
        lastActivityDate: m.u.lastActivityAt ? m.u.lastActivityAt.toISOString().slice(0, 10) : null,
      },
      tracks: trackDetails,
      attempts: att.map(({ a, title, trackTitle }) => ({ id: a.id, title, trackTitle, number: a.attemptNumber, status: a.status, score: a.score, passed: a.passed, submittedAt: a.submittedAt })),
      submissions: subs.map(({ s, title, stage, competency, trackTitle }) => ({
        id: s.id,
        title,
        stage,
        competency,
        trackTitle,
        status: s.status,
        submittedAt: s.submittedAt,
        reviewerComment: s.reviewerComment,
      })),
      feedback: fb.map(({ f, author }) => ({ id: f.id, kind: f.kind, body: f.body, author, reference: f.reference, createdAt: f.createdAt })),
      access: ruleDetails,
    };
  });

  async function resourceTitle(type: string, id: string) {
    const { contents, modules } = await import("../db/schema.js");
    if (type === "area") return (await db.select({ t: knowledgeAreas.name }).from(knowledgeAreas).where(eq(knowledgeAreas.id, id)))[0]?.t ?? "";
    if (type === "track") return (await db.select({ t: tracks.title }).from(tracks).where(eq(tracks.id, id)))[0]?.t ?? "";
    if (type === "module") return (await db.select({ t: modules.title }).from(modules).where(eq(modules.id, id)))[0]?.t ?? "";
    return (await db.select({ t: contents.title }).from(contents).where(eq(contents.id, id)))[0]?.t ?? "";
  }

  // ----------------------------------------------------------------- Atribuições
  app.post("/api/leader/assignments", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(
      z.object({
        userIds: z.array(z.string().uuid()).min(1).max(200),
        trackId: z.string().uuid(),
        dueDate: z.string().date().nullable().optional(),
        isMandatory: z.boolean().default(true),
      }),
      req.body,
    );
    const [track] = await db.select().from(tracks).where(eq(tracks.id, body.trackId));
    if (!track || track.status !== "published") throw notFound("Trilha não encontrada ou não publicada.");
    if (!canManageArea(scope, track.areaId, "view")) throw forbidden("Esta trilha não pertence às suas áreas.");
    for (const uid of body.userIds) await assertCanManageUser(db, scope, uid);
    const due = body.dueDate ? new Date(`${body.dueDate}T23:59:59-03:00`) : null;
    const source = user.role === "admin" ? "admin" : "leader";
    for (const uid of body.userIds) {
      await db
        .insert(enrollments)
        .values({ userId: uid, trackId: track.id, source, assignedBy: user.id, isMandatory: body.isMandatory, dueDate: due })
        .onConflictDoUpdate({
          target: [enrollments.userId, enrollments.trackId],
          set: { source, assignedBy: user.id, isMandatory: body.isMandatory, dueDate: due, updatedAt: new Date() },
        });
      await refreshEnrollment(app.ctx, uid, track.id);
      await notify(app.ctx, {
        userId: uid,
        type: "track_assigned",
        title: "Nova trilha atribuída",
        body: `${user.name} atribuiu a trilha “${track.title}”${due ? ` com prazo até ${due.toLocaleDateString("pt-BR")}` : ""}.`,
        link: `/trilhas/${track.id}`,
        dedupeKey: `assign:${track.id}:${body.dueDate ?? "sem-prazo"}`,
      });
    }
    await audit(req, "assignment.created", { targetType: "track", targetId: track.id, metadata: { users: body.userIds, dueDate: body.dueDate ?? null } });
    return { ok: true, assigned: body.userIds.length };
  });

  app.delete("/api/leader/assignments", async (req) => {
    const { scope } = await managerContext(req);
    const body = parse(z.object({ userId: z.string().uuid(), trackId: z.string().uuid() }), req.body);
    await assertCanManageUser(db, scope, body.userId);
    const [track] = await db.select().from(tracks).where(eq(tracks.id, body.trackId));
    if (!track || !canManageArea(scope, track.areaId, "view")) throw forbidden("Esta trilha não pertence às suas áreas.");
    // O progresso é preservado; só a atribuição (e o acesso que ela concedia) é removida.
    const rows = await db
      .update(enrollments)
      .set({ source: "self", isMandatory: false, dueDate: null, assignedBy: null, updatedAt: new Date() })
      .where(and(eq(enrollments.userId, body.userId), eq(enrollments.trackId, body.trackId)))
      .returning({ id: enrollments.id });
    if (!rows.length) throw notFound("Atribuição não encontrada.");
    await audit(req, "assignment.removed", { targetType: "track", targetId: body.trackId, metadata: { user: body.userId } });
    return { ok: true };
  });

  // ----------------------------------------------------------------- Acessos no escopo do líder
  app.post("/api/leader/access", async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(
      z.object({
        userId: z.string().uuid(),
        resourceType: z.enum(ACCESS_RESOURCES),
        resourceId: z.string().uuid(),
        effect: z.enum(["allow", "deny"]),
        note: z.string().trim().max(500).default(""),
        expiresAt: z.string().date().nullable().optional(),
      }),
      req.body,
    );
    await assertCanManageUser(db, scope, body.userId);
    const areaId = await resourceAreaId(db, body.resourceType, body.resourceId);
    if (!areaId) throw notFound("Recurso não encontrado.");
    // O líder só concede acesso a conteúdos das áreas pelas quais responde (nunca acima do próprio escopo).
    if (!canManageArea(scope, areaId, "view")) throw forbidden("Você não pode conceder acesso fora das suas áreas.");
    const [rule] = await db
      .insert(accessRules)
      .values({
        subjectType: "user",
        subjectId: body.userId,
        resourceType: body.resourceType,
        resourceId: body.resourceId,
        effect: body.effect,
        note: body.note,
        grantedBy: user.id,
        expiresAt: body.expiresAt ? new Date(`${body.expiresAt}T23:59:59-03:00`) : null,
      })
      .returning();
    await audit(req, "access.rule_created", { targetType: "access_rule", targetId: rule!.id, metadata: { ...body } });
    return rule;
  });

  app.delete("/api/leader/access/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const [rule] = await db.select().from(accessRules).where(eq(accessRules.id, id));
    if (!rule || rule.subjectType !== "user" || !rule.subjectId) throw notFound();
    await assertCanManageUser(db, scope, rule.subjectId);
    const areaId = await resourceAreaId(db, rule.resourceType, rule.resourceId);
    if (!areaId || !canManageArea(scope, areaId, "view")) throw notFound();
    await db.delete(accessRules).where(eq(accessRules.id, id));
    await audit(req, "access.rule_deleted", { targetType: "access_rule", targetId: id, metadata: { subject: rule.subjectId, resource: rule.resourceId, effect: rule.effect } });
    return { ok: true };
  });

  // ----------------------------------------------------------------- Feedback
  app.post("/api/leader/feedback", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(
      z.object({
        userId: z.string().uuid(),
        kind: z.enum(FEEDBACK_KINDS).default("feedback"),
        body: z.string().trim().min(1, "Escreva o feedback.").max(5000),
        trackId: z.string().uuid().nullable().optional(),
        reference: z.object({ type: z.enum(["track", "content", "library"]), id: z.string().uuid(), title: z.string().max(300).optional() }).nullable().optional(),
      }),
      req.body,
    );
    await assertCanManageUser(db, scope, body.userId);
    const [row] = await db
      .insert(feedbacks)
      .values({ userId: body.userId, authorId: user.id, kind: body.kind, body: body.body, trackId: body.trackId ?? null, reference: body.reference ?? null })
      .returning();
    await notify(app.ctx, {
      userId: body.userId,
      type: "leader_feedback",
      title: body.kind === "recommendation" ? "Nova recomendação do seu líder" : "Novo feedback do seu líder",
      body: body.body.slice(0, 200),
      link: "/minha-evolucao",
      dedupeKey: `fb:${row!.id}`,
    });
    await audit(req, "feedback.created", { targetType: "user", targetId: body.userId });
    return { id: row!.id };
  });

  // ----------------------------------------------------------------- Validações
  app.get("/api/leader/validations", async (req) => {
    const { scope } = await managerContext(req);
    const ids = await managedUserIds(db, scope);
    if (!ids.length) return { submissions: [], attempts: [], tracks: [] };
    const subs = await db
      .select({ s: practicalSubmissions, a: practicalActivities, trackTitle: tracks.title, areaId: tracks.areaId, userName: users.name })
      .from(practicalSubmissions)
      .innerJoin(practicalActivities, eq(practicalActivities.id, practicalSubmissions.activityId))
      .innerJoin(tracks, eq(tracks.id, practicalActivities.trackId))
      .innerJoin(users, eq(users.id, practicalSubmissions.userId))
      .where(and(inArray(practicalSubmissions.userId, ids), eq(practicalSubmissions.status, "submitted"), eq(practicalActivities.requiresValidation, true)))
      .orderBy(asc(practicalSubmissions.submittedAt));
    const pendingAttempts = await db
      .select({ a: attempts, title: assessments.title, trackTitle: tracks.title, areaId: tracks.areaId, userName: users.name })
      .from(attempts)
      .innerJoin(assessments, eq(assessments.id, attempts.assessmentId))
      .innerJoin(tracks, eq(tracks.id, assessments.trackId))
      .innerJoin(users, eq(users.id, attempts.userId))
      .where(and(inArray(attempts.userId, ids), eq(attempts.status, "pending_review")))
      .orderBy(asc(attempts.submittedAt));
    const pendingTracks = await db
      .select({ e: enrollments, t: tracks, userName: users.name })
      .from(enrollments)
      .innerJoin(tracks, eq(tracks.id, enrollments.trackId))
      .innerJoin(users, eq(users.id, enrollments.userId))
      .where(and(inArray(enrollments.userId, ids), eq(enrollments.status, "pending_validation"), eq(tracks.requiresLeaderValidation, true)));
    const reading = await settings.get("reading");
    const tracksAwaiting = [];
    for (const row of pendingTracks) {
      if (!canManageArea(scope, row.t.areaId, "view")) continue;
      const s = await loadTrackStructure(db, row.t.id, false);
      if (!s) continue;
      const v = computeTrackView(s, await loadUserTrackState(db, row.e.userId, s), { reading });
      const others = v.pillars.studied.done === v.pillars.studied.total && v.pillars.assessed.done === v.pillars.assessed.total;
      const activitiesDone = v.pillars.demonstrated.done === v.pillars.demonstrated.total && v.pillars.applied.done === v.pillars.applied.total;
      if (others && activitiesDone && v.validation.status !== "approved") {
        tracksAwaiting.push({ userId: row.e.userId, userName: row.userName, trackId: row.t.id, trackTitle: row.t.title, pillars: v.pillars });
      }
    }
    return {
      submissions: subs
        .filter((r) => canManageArea(scope, r.areaId, "view"))
        .map((r) => ({
          id: r.s.id,
          userId: r.s.userId,
          userName: r.userName,
          activityTitle: r.a.title,
          instructions: r.a.instructions,
          stage: r.a.stage,
          competency: r.a.competency,
          trackTitle: r.trackTitle,
          body: r.s.body,
          link: r.s.link,
          attemptNumber: r.s.attemptNumber,
          submittedAt: r.s.submittedAt,
        })),
      attempts: pendingAttempts
        .filter((r) => canManageArea(scope, r.areaId, "view"))
        .map((r) => ({ id: r.a.id, userId: r.a.userId, userName: r.userName, title: r.title, trackTitle: r.trackTitle, number: r.a.attemptNumber, submittedAt: r.a.submittedAt })),
      tracks: tracksAwaiting,
    };
  });

  async function submissionInScope(id: string, scope: Awaited<ReturnType<typeof managerContext>>["scope"]) {
    const [row] = await db
      .select({ s: practicalSubmissions, a: practicalActivities, areaId: tracks.areaId })
      .from(practicalSubmissions)
      .innerJoin(practicalActivities, eq(practicalActivities.id, practicalSubmissions.activityId))
      .innerJoin(tracks, eq(tracks.id, practicalActivities.trackId))
      .where(eq(practicalSubmissions.id, id));
    if (!row) throw notFound();
    await assertCanManageUser(db, scope, row.s.userId);
    if (!canManageArea(scope, row.areaId, "view")) throw notFound();
    return row;
  }

  app.post("/api/leader/submissions/:id/review", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({ decision: z.enum(["approved", "rejected", "returned"]), comment: z.string().trim().max(5000).default("") }),
      req.body,
    );
    const row = await submissionInScope(id, scope);
    if (row.s.status !== "submitted") throw badRequest("Esta entrega já foi avaliada.");
    if (body.decision !== "approved" && !body.comment) throw badRequest("Explique o motivo para o colaborador.");
    await db
      .update(practicalSubmissions)
      .set({ status: body.decision, reviewedBy: user.id, reviewedAt: new Date(), reviewerComment: body.comment })
      .where(eq(practicalSubmissions.id, id));
    await refreshEnrollment(app.ctx, row.s.userId, row.a.trackId);
    const label = body.decision === "approved" ? "aprovada" : body.decision === "rejected" ? "reprovada" : "devolvida para ajustes";
    await notify(app.ctx, {
      userId: row.s.userId,
      type: "submission_reviewed",
      title: `Atividade prática ${label}`,
      body: `“${row.a.title}”${body.comment ? `: ${body.comment.slice(0, 160)}` : ""}`,
      link: `/atividades/${row.a.id}`,
      dedupeKey: `review:${id}`,
    });
    await audit(req, "activity.reviewed", { targetType: "submission", targetId: id, metadata: { decision: body.decision } });
    return { ok: true };
  });

  async function attemptInScope(id: string, scope: Awaited<ReturnType<typeof managerContext>>["scope"]) {
    const [row] = await db
      .select({ a: attempts, as: assessments, areaId: tracks.areaId })
      .from(attempts)
      .innerJoin(assessments, eq(assessments.id, attempts.assessmentId))
      .innerJoin(tracks, eq(tracks.id, assessments.trackId))
      .where(eq(attempts.id, id));
    if (!row) throw notFound();
    await assertCanManageUser(db, scope, row.a.userId);
    if (!canManageArea(scope, row.areaId, "view")) throw notFound();
    return row;
  }

  app.get("/api/leader/attempts/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const row = await attemptInScope(id, scope);
    const qs = row.a.questionIds.length ? await db.select().from(questions).where(inArray(questions.id, row.a.questionIds)) : [];
    const saved = await db.select().from(answers).where(eq(answers.attemptId, id));
    const [member] = await db.select({ name: users.name }).from(users).where(eq(users.id, row.a.userId));
    return {
      attempt: { id: row.a.id, number: row.a.attemptNumber, status: row.a.status, score: row.a.score, passed: row.a.passed, submittedAt: row.a.submittedAt, feedback: row.a.feedback },
      assessment: { id: row.as.id, title: row.as.title, passingScore: row.as.passingScore },
      member: { id: row.a.userId, name: member?.name ?? "" },
      questions: row.a.questionIds
        .map((qid) => qs.find((q) => q.id === qid))
        .filter((q): q is NonNullable<typeof q> => !!q)
        .map((q) => {
          const a = saved.find((x) => x.questionId === q.id);
          return {
            ...sanitizeQuestion(q, row.a.id, false),
            answerKey: answerKeyForFeedback(q),
            explanation: q.explanation,
            response: a?.response ?? null,
            isCorrect: a?.isCorrect ?? null,
            pointsAwarded: a?.pointsAwarded ?? null,
            maxPoints: a?.maxPoints ?? q.points,
            reviewerComment: a?.reviewerComment ?? null,
          };
        }),
    };
  });

  app.post("/api/leader/attempts/:id/grade", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        answers: z.array(z.object({ questionId: z.string().uuid(), points: z.number().min(0), comment: z.string().trim().max(3000).default("") })).max(200),
        feedback: z.string().trim().max(5000).default(""),
      }),
      req.body,
    );
    const row = await attemptInScope(id, scope);
    if (row.a.status !== "pending_review") throw badRequest("Esta tentativa não está aguardando correção.");
    const saved = await db.select().from(answers).where(eq(answers.attemptId, id));
    for (const g of body.answers) {
      const a = saved.find((x) => x.questionId === g.questionId);
      if (!a) continue;
      const pts = Math.min(g.points, a.maxPoints);
      await db
        .update(answers)
        .set({ pointsAwarded: pts, isCorrect: pts >= a.maxPoints, reviewerComment: g.comment || null, reviewedBy: user.id, reviewedAt: new Date() })
        .where(and(eq(answers.attemptId, id), eq(answers.questionId, g.questionId)));
    }
    const final = await db.select().from(answers).where(eq(answers.attemptId, id));
    if (final.some((a) => a.pointsAwarded === null)) throw badRequest("Atribua pontuação a todas as questões discursivas.");
    const total = final.reduce((s, a) => s + a.maxPoints, 0);
    const got = final.reduce((s, a) => s + (a.pointsAwarded ?? 0), 0);
    const score = total ? Math.round((got / total) * 1000) / 10 : 0;
    const passed = score >= row.as.passingScore;
    await db
      .update(attempts)
      .set({ status: "graded", score, passed, gradedBy: user.id, gradedAt: new Date(), feedback: body.feedback || null })
      .where(eq(attempts.id, id));
    await refreshEnrollment(app.ctx, row.a.userId, row.as.trackId);
    await notify(app.ctx, {
      userId: row.a.userId,
      type: "assessment_graded",
      title: passed ? "Avaliação aprovada" : "Avaliação corrigida",
      body: `${row.as.title}: ${score.toLocaleString("pt-BR")}% de aproveitamento.`,
      link: `/avaliacoes/${row.as.id}/tentativas/${id}`,
      dedupeKey: `graded:${id}`,
    });
    await audit(req, "assessment.graded", { targetType: "attempt", targetId: id, metadata: { score, passed } });
    return { ok: true, score, passed };
  });

  app.post("/api/leader/validations", async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(
      z.object({ userId: z.string().uuid(), trackId: z.string().uuid(), decision: z.enum(["approved", "rejected"]), comment: z.string().trim().max(5000).default("") }),
      req.body,
    );
    await assertCanManageUser(db, scope, body.userId);
    const [track] = await db.select().from(tracks).where(eq(tracks.id, body.trackId));
    if (!track || !canManageArea(scope, track.areaId, "view")) throw forbidden("Esta trilha não pertence às suas áreas.");
    if (body.decision === "rejected" && !body.comment) throw badRequest("Explique o que precisa ser revisto.");
    await db.insert(trackValidations).values({ userId: body.userId, trackId: body.trackId, decision: body.decision, comment: body.comment, validatedBy: user.id });
    await refreshEnrollment(app.ctx, body.userId, body.trackId);
    await notify(app.ctx, {
      userId: body.userId,
      type: "leader_feedback",
      title: body.decision === "approved" ? "Competência validada pelo líder" : "Validação: revisão necessária",
      body: `${track.title}${body.comment ? ` — ${body.comment.slice(0, 160)}` : ""}`,
      link: `/trilhas/${track.id}`,
      dedupeKey: `validation:${body.trackId}:${Date.now()}`,
    });
    await audit(req, "track.validated", { targetType: "track", targetId: body.trackId, metadata: { user: body.userId, decision: body.decision } });
    return { ok: true };
  });

  // ----------------------------------------------------------------- Solicitações no escopo
  app.get("/api/leader/requests", async (req) => {
    const { scope } = await managerContext(req);
    const rows = await db
      .select({ r: requests, userName: users.name, trackTitle: tracks.title, areaName: knowledgeAreas.name })
      .from(requests)
      .innerJoin(users, eq(users.id, requests.requesterId))
      .leftJoin(tracks, eq(tracks.id, requests.resourceId))
      .leftJoin(knowledgeAreas, eq(knowledgeAreas.id, requests.areaId))
      .orderBy(desc(requests.createdAt))
      .limit(200);
    return rows
      .filter(({ r }) => scope.role === "admin" || (r.areaId && scope.leaderAreaIds.has(r.areaId)))
      .map(({ r, userName, trackTitle, areaName }) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        userName,
        requesterId: r.requesterId,
        title: r.title || trackTitle || "",
        trackId: r.resourceType === "track" ? r.resourceId : null,
        areaName,
        message: r.message,
        resolutionNote: r.resolutionNote,
        createdAt: r.createdAt,
      }));
  });

  app.post("/api/leader/requests/:id/resolve", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const body = parse(z.object({ decision: z.enum(["approved", "rejected", "closed"]), note: z.string().trim().max(2000).default("") }), req.body);
    const [r] = await db.select().from(requests).where(eq(requests.id, id));
    if (!r || (scope.role !== "admin" && (!r.areaId || !scope.leaderAreaIds.has(r.areaId)))) throw notFound();
    if (r.status !== "open") throw badRequest("Solicitação já respondida.");
    if (r.type === "access" && body.decision === "approved") {
      if (!r.resourceId) throw badRequest("Solicitação sem trilha.");
      if (scope.role !== "admin") await assertCanManageUser(db, scope, r.requesterId);
      await db.insert(accessRules).values({
        subjectType: "user",
        subjectId: r.requesterId,
        resourceType: "track",
        resourceId: r.resourceId,
        effect: "allow",
        note: `Solicitação aprovada${body.note ? `: ${body.note}` : ""}`,
        grantedBy: user.id,
      });
    }
    await db.update(requests).set({ status: body.decision, resolvedBy: user.id, resolvedAt: new Date(), resolutionNote: body.note }).where(eq(requests.id, id));
    await notify(app.ctx, {
      userId: r.requesterId,
      type: "request_resolved",
      title: body.decision === "approved" ? "Solicitação aprovada" : "Solicitação respondida",
      body: body.note || (r.type === "access" && body.decision === "approved" ? "Seu acesso foi liberado." : "Sua solicitação foi analisada."),
      link: r.type === "access" && r.resourceId ? `/trilhas/${r.resourceId}` : "/ajuda",
      dedupeKey: `resolved:${id}`,
    });
    await audit(req, "request.resolved", { targetType: "request", targetId: id, metadata: { decision: body.decision } });
    return { ok: true };
  });

  // ----------------------------------------------------------------- Relatório exportável
  app.get("/api/leader/report.csv", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { scope } = await managerContext(req);
    const ids = await managedUserIds(db, scope);
    const rows = ids.length
      ? await db
          .select({ e: enrollments, u: users, t: tracks, areaName: knowledgeAreas.name })
          .from(enrollments)
          .innerJoin(users, eq(users.id, enrollments.userId))
          .innerJoin(tracks, eq(tracks.id, enrollments.trackId))
          .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
          .where(inArray(enrollments.userId, ids))
          .orderBy(asc(users.name), asc(tracks.title))
      : [];
    const csv = toCsv(
      ["Colaborador", "Identificador", "Área", "Trilha", "Status", "Progresso (%)", "Obrigatória", "Prazo", "Início", "Conclusão"],
      rows.map(({ e, u, t, areaName }) => [
        u.name,
        userCode(u.seq),
        areaName,
        t.title,
        LEARNER_TRACK_STATUS_LABEL[e.status],
        e.progressPercent,
        e.isMandatory || t.mode === "obrigatoria" ? "Sim" : "Não",
        e.dueDate ? e.dueDate.toISOString().slice(0, 10) : "",
        e.startedAt ? e.startedAt.toISOString().slice(0, 10) : "",
        e.completedAt ? e.completedAt.toISOString().slice(0, 10) : "",
      ]),
    );
    await audit(req, "report.exported", { metadata: { kind: "team", rows: rows.length } });
    reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="relatorio-equipe-${new Date().toISOString().slice(0, 10)}.csv"`);
    return csv;
  });

}
