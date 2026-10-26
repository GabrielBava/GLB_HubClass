import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  assessments,
  attempts,
  certificates,
  contentProgress,
  contents,
  departments,
  enrollments,
  feedbacks,
  jobTitles,
  libraryItems,
  modules,
  practicalActivities,
  practicalSubmissions,
  tracks,
  users,
} from "../db/schema.js";
import type { AppContext } from "../app.js";
import { z } from "zod";
import { currentUser } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { learnerContext, trackForUser, type LearnerContext } from "../services/access.js";
import { evaluateTrackAccess, loadCatalogIndex } from "../services/catalog.js";
import { notify } from "../services/notifications.js";
import type { TrackView } from "../services/learning.js";

const DAY = 86_400_000;

/** Gera (uma única vez) os avisos de prazo próximo e de treinamento atrasado. */
export async function deadlineReminders(ctx: AppContext, userId: string) {
  const prefs = await ctx.settings.get("notifications");
  const rows = await ctx.db
    .select({ e: enrollments, title: tracks.title })
    .from(enrollments)
    .innerJoin(tracks, eq(tracks.id, enrollments.trackId))
    .where(and(eq(enrollments.userId, userId), isNotNull(enrollments.dueDate)));
  const now = Date.now();
  for (const { e, title } of rows) {
    if (!e.dueDate || e.status === "completed") continue;
    const due = e.dueDate.getTime();
    if (due < now) {
      await notify(ctx, {
        userId,
        type: "deadline_overdue",
        title: "Treinamento atrasado",
        body: `O prazo da trilha “${title}” venceu em ${e.dueDate.toLocaleDateString("pt-BR")}.`,
        link: `/trilhas/${e.trackId}`,
        dedupeKey: `overdue:${e.id}:${e.dueDate.toISOString().slice(0, 10)}`,
      });
    } else if (due - now < prefs.deadlineReminderDays * DAY) {
      await notify(ctx, {
        userId,
        type: "deadline_near",
        title: "Prazo próximo",
        body: `A trilha “${title}” vence em ${e.dueDate.toLocaleDateString("pt-BR")}.`,
        link: `/trilhas/${e.trackId}`,
        dedupeKey: `near:${e.id}:${e.dueDate.toISOString().slice(0, 10)}`,
      });
    }
  }
}

interface RelevantTrack {
  trackId: string;
  title: string;
  areaName: string;
  areaColor: string;
  mode: string;
  isMandatory: boolean;
  dueDate: Date | null;
  view: TrackView;
}

/** Trilhas relevantes para o usuário: atribuídas, iniciadas e obrigatórias liberadas. */
async function relevantTracks(req: FastifyRequest, lc: LearnerContext): Promise<RelevantTrack[]> {
  const { db, settings } = req.server.ctx;
  const reading = await settings.get("reading");
  const index = await loadCatalogIndex(db, reading);
  const enr = await db.select().from(enrollments).where(eq(enrollments.userId, lc.user.id));
  const ids = new Set(enr.map((e) => e.trackId));
  for (const t of index.tracks) {
    if (t.mode !== "obrigatoria" || t.status !== "published") continue;
    const area = index.areaById.get(t.areaId);
    if (!area) continue;
    const access = evaluateTrackAccess(lc.evaluator, area, t, index.modulesByTrack.get(t.id) ?? [], (m) => index.contentsByModule.get(m) ?? []);
    if (access.access !== "none" && (index.modulesByTrack.get(t.id)?.length ?? 0) > 0) ids.add(t.id);
  }
  const out: RelevantTrack[] = [];
  for (const id of ids) {
    const track = index.tracks.find((t) => t.id === id);
    if (!track) continue;
    try {
      const tv = await trackForUser(req, id, lc, { auditDenied: false });
      const e = enr.find((x) => x.trackId === id);
      out.push({
        trackId: id,
        title: track.title,
        areaName: tv.structure.area.name,
        areaColor: tv.structure.area.color,
        mode: track.mode,
        isMandatory: track.mode === "obrigatoria" || !!e?.isMandatory,
        dueDate: e?.dueDate ?? null,
        view: tv.view,
      });
    } catch {
      // Sem acesso (ex.: atribuição revogada): a trilha não aparece no painel.
    }
  }
  return out;
}

export async function dashboardRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  app.get("/api/dashboard", async (req) => {
    const lc = await learnerContext(req);
    const userId = lc.user.id;
    await deadlineReminders(app.ctx, userId);
    const rel = await relevantTracks(req, lc);

    const [profile] = await db
      .select({ jobTitle: jobTitles.name, department: departments.name })
      .from(users)
      .leftJoin(jobTitles, eq(jobTitles.id, users.jobTitleId))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(users.id, userId));

    const [last] = await db
      .select({ p: contentProgress, title: contents.title, type: contents.type, trackTitle: tracks.title, trackId: tracks.id })
      .from(contentProgress)
      .innerJoin(contents, eq(contents.id, contentProgress.contentId))
      .innerJoin(modules, eq(modules.id, contents.moduleId))
      .innerJoin(tracks, eq(tracks.id, modules.trackId))
      .where(and(eq(contentProgress.userId, userId), eq(contents.status, "published")))
      .orderBy(desc(contentProgress.updatedAt))
      .limit(1);
    // Só oferece "continuar" se o conteúdo ainda estiver liberado.
    const lastAllowed = last && rel.some((r) => r.view.modules.some((m) => m.contents.some((c) => c.id === last.p.contentId && !c.locked)));

    const active = rel.filter((r) => r.view.status !== "completed");
    const sorted = [...active].sort((a, b) => {
      if (a.isMandatory !== b.isMandatory) return a.isMandatory ? -1 : 1;
      const da = a.dueDate?.getTime() ?? Infinity;
      const dbb = b.dueDate?.getTime() ?? Infinity;
      return da - dbb;
    });
    const nextTrack = sorted.find((r) => r.view.next);
    const pendingAssessments = active.flatMap((r) =>
      [...r.view.modules.flatMap((m) => m.assessments), ...r.view.finalAssessments]
        .filter((a) => a.isRequired && !a.locked && ["not_started", "in_progress", "failed", "pending_review"].includes(a.status))
        .map((a) => ({ id: a.id, title: a.title, status: a.status, trackId: r.trackId, trackTitle: r.title })),
    );

    const accessibleTrackIds = rel.map((r) => r.trackId);
    const recent = await db
      .select({ id: contents.id, title: contents.title, publishedAt: contents.publishedAt, trackTitle: tracks.title, trackId: tracks.id })
      .from(contents)
      .innerJoin(modules, eq(modules.id, contents.moduleId))
      .innerJoin(tracks, eq(tracks.id, modules.trackId))
      .where(and(eq(contents.status, "published"), gte(contents.publishedAt, new Date(Date.now() - 45 * DAY))))
      .orderBy(desc(contents.publishedAt))
      .limit(20);
    const recentVisible = [];
    for (const r of recent) {
      if (recentVisible.length >= 5) break;
      if (accessibleTrackIds.includes(r.trackId)) recentVisible.push(r);
    }

    const certs = await db
      .select({ code: certificates.code, issuedAt: certificates.issuedAt, trackTitle: tracks.title, trackId: tracks.id })
      .from(certificates)
      .innerJoin(tracks, eq(tracks.id, certificates.trackId))
      .where(eq(certificates.userId, userId))
      .orderBy(desc(certificates.issuedAt));

    const fb = await db
      .select({ f: feedbacks, author: users.name })
      .from(feedbacks)
      .leftJoin(users, eq(users.id, feedbacks.authorId))
      .where(eq(feedbacks.userId, userId))
      .orderBy(desc(feedbacks.createdAt))
      .limit(5);

    const reading = await db
      .select({ id: libraryItems.id, title: libraryItems.title, author: libraryItems.author, type: libraryItems.type, coverColor: libraryItems.coverColor, estimatedMinutes: libraryItems.estimatedMinutes })
      .from(libraryItems)
      .where(eq(libraryItems.status, "published"))
      .orderBy(libraryItems.sortOrder)
      .limit(4);

    const percentBase = rel.filter((r) => r.view.status !== "not_started" || r.isMandatory);
    const overall = percentBase.length ? Math.round(percentBase.reduce((s, r) => s + r.view.percent, 0) / percentBase.length) : 0;
    const now = Date.now();
    const mapTrack = (r: RelevantTrack) => ({
      id: r.trackId,
      title: r.title,
      areaName: r.areaName,
      areaColor: r.areaColor,
      status: r.view.status,
      percent: r.view.percent,
      remainingMinutes: r.view.remainingMinutes,
      estimatedMinutes: r.view.estimatedMinutes,
      isMandatory: r.isMandatory,
      dueDate: r.dueDate,
      overdue: !!r.dueDate && r.dueDate.getTime() < now && r.view.status !== "completed",
    });

    return {
      user: { name: lc.user.name, jobTitle: profile?.jobTitle ?? null, department: profile?.department ?? null },
      summary: {
        overallPercent: overall,
        inProgress: rel.filter((r) => !["not_started", "completed"].includes(r.view.status)).length,
        completed: rel.filter((r) => r.view.status === "completed").length,
        mandatoryPending: rel.filter((r) => r.isMandatory && r.view.status !== "completed").length,
        remainingMinutes: active.reduce((s, r) => s + r.view.remainingMinutes, 0),
        certificates: certs.length,
      },
      continue:
        last && lastAllowed && last.p.status !== "completed"
          ? { contentId: last.p.contentId, title: last.title, type: last.type, trackTitle: last.trackTitle, trackId: last.trackId, lastPage: last.p.lastPage, percent: last.p.percent }
          : null,
      lastAccessed: last && lastAllowed ? { contentId: last.p.contentId, title: last.title, trackTitle: last.trackTitle, updatedAt: last.p.updatedAt } : null,
      next: nextTrack?.view.next ? { ...nextTrack.view.next, trackId: nextTrack.trackId, trackTitle: nextTrack.title } : null,
      inProgress: rel.filter((r) => !["not_started", "completed"].includes(r.view.status)).map(mapTrack),
      mandatory: rel.filter((r) => r.isMandatory).map(mapTrack),
      deadlines: rel
        .filter((r) => r.dueDate && r.view.status !== "completed")
        .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())
        .map(mapTrack),
      pendingAssessments,
      recentContents: recentVisible,
      certificates: certs,
      feedback: fb.map(({ f, author }) => ({ id: f.id, kind: f.kind, body: f.body, author, reference: f.reference, createdAt: f.createdAt })),
      reading,
    };
  });

  app.get("/api/me/progress", async (req) => {
    const lc = await learnerContext(req);
    const userId = lc.user.id;
    const rel = await relevantTracks(req, lc);
    const attemptRows = await db
      .select({ a: attempts, title: assessments.title, trackTitle: tracks.title })
      .from(attempts)
      .innerJoin(assessments, eq(assessments.id, attempts.assessmentId))
      .innerJoin(tracks, eq(tracks.id, assessments.trackId))
      .where(eq(attempts.userId, userId))
      .orderBy(desc(attempts.startedAt))
      .limit(100);
    const subs = await db
      .select({ s: practicalSubmissions, title: practicalActivities.title, stage: practicalActivities.stage, competency: practicalActivities.competency, trackTitle: tracks.title })
      .from(practicalSubmissions)
      .innerJoin(practicalActivities, eq(practicalActivities.id, practicalSubmissions.activityId))
      .innerJoin(tracks, eq(tracks.id, practicalActivities.trackId))
      .where(eq(practicalSubmissions.userId, userId))
      .orderBy(desc(practicalSubmissions.submittedAt))
      .limit(100);
    const certs = await db
      .select({ code: certificates.code, issuedAt: certificates.issuedAt, trackTitle: tracks.title, trackId: tracks.id })
      .from(certificates)
      .innerJoin(tracks, eq(tracks.id, certificates.trackId))
      .where(eq(certificates.userId, userId));
    const fb = await db
      .select({ f: feedbacks, author: users.name, trackTitle: tracks.title })
      .from(feedbacks)
      .leftJoin(users, eq(users.id, feedbacks.authorId))
      .leftJoin(tracks, eq(tracks.id, feedbacks.trackId))
      .where(eq(feedbacks.userId, userId))
      .orderBy(desc(feedbacks.createdAt));
    const [totals] = await db
      .select({
        active: sql<number>`coalesce(sum(${contentProgress.activeSeconds}), 0)::int`,
        completed: sql<number>`count(*) filter (where ${contentProgress.status} = 'completed')::int`,
      })
      .from(contentProgress)
      .where(eq(contentProgress.userId, userId));
    const enr = rel.length
      ? await db
          .select()
          .from(enrollments)
          .where(and(eq(enrollments.userId, userId), inArray(enrollments.trackId, rel.map((r) => r.trackId))))
      : [];
    return {
      tracks: rel.map((r) => {
        const e = enr.find((x) => x.trackId === r.trackId);
        return {
          id: r.trackId,
          title: r.title,
          areaName: r.areaName,
          areaColor: r.areaColor,
          status: r.view.status,
          percent: r.view.percent,
          pillars: r.view.pillars,
          validation: r.view.validation,
          isMandatory: r.isMandatory,
          dueDate: r.dueDate,
          startedAt: e?.startedAt ?? null,
          completedAt: e?.completedAt ?? null,
          estimatedMinutes: r.view.estimatedMinutes,
          remainingMinutes: r.view.remainingMinutes,
        };
      }),
      attempts: attemptRows.map(({ a, title, trackTitle }) => ({
        id: a.id,
        assessmentId: a.assessmentId,
        title,
        trackTitle,
        number: a.attemptNumber,
        status: a.status,
        score: a.score,
        passed: a.passed,
        submittedAt: a.submittedAt,
      })),
      submissions: subs.map(({ s, title, stage, competency, trackTitle }) => ({
        id: s.id,
        activityId: s.activityId,
        title,
        stage,
        competency,
        trackTitle,
        status: s.status,
        submittedAt: s.submittedAt,
        reviewerComment: s.reviewerComment,
      })),
      certificates: certs,
      feedback: fb.map(({ f, author, trackTitle }) => ({ id: f.id, kind: f.kind, body: f.body, author, trackTitle, reference: f.reference, createdAt: f.createdAt })),
      totals: {
        activeMinutes: Math.round((totals?.active ?? 0) / 60),
        contentsCompleted: totals?.completed ?? 0,
        assessmentsPassed: attemptRows.filter((x) => x.a.passed).length,
        practicalApproved: subs.filter((x) => x.s.status === "approved").length,
      },
    };
  });

  app.get("/api/certificates/:code", async (req) => {
    const { code } = parse(z.object({ code: z.string().min(4).max(20) }), req.params);
    const user = currentUser(req);
    const [row] = await db
      .select({ c: certificates, trackTitle: tracks.title, userName: users.name, ownerId: certificates.userId, ownerName: users.name })
      .from(certificates)
      .innerJoin(tracks, eq(tracks.id, certificates.trackId))
      .innerJoin(users, eq(users.id, certificates.userId))
      .where(eq(certificates.code, code.toUpperCase()));
    if (!row || (row.ownerId !== user.id && user.role !== "admin")) {
      return { found: false };
    }
    return { found: true, code: row.c.code, issuedAt: row.c.issuedAt, trackTitle: row.trackTitle, name: row.ownerName };
  });
}
