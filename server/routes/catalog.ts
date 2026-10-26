import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LEARNER_TRACK_STATUS, LEVELS, TRACK_MODES } from "../../shared/domain.js";
import { certificates, enrollments, jobTitles, requests, tracks } from "../db/schema.js";
import { forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { learnerContext, moduleForUser, trackForUser } from "../services/access.js";
import { enrollmentMap, evaluateTrackAccess, loadCatalogIndex, publishedModuleCount, trackEstimatedMinutes } from "../services/catalog.js";
import { refreshEnrollment } from "../services/progress.js";

export async function catalogRoutes(app: FastifyInstance) {
  const { db, settings } = app.ctx;

  /** Lista de trilhas com acesso, progresso e disponibilidade calculados para o usuário. */
  async function catalogFor(req: Parameters<typeof learnerContext>[0]) {
    const lc = await learnerContext(req);
    const reading = await settings.get("reading");
    const catalogSettings = await settings.get("catalog");
    const index = await loadCatalogIndex(db, reading);
    const enr = await enrollmentMap(db, lc.user.id);
    const titles = new Map(index.tracks.map((t) => [t.id, t.title]));
    const items = [];
    for (const track of index.tracks) {
      const area = index.areaById.get(track.areaId);
      if (!area) continue;
      const mods = index.modulesByTrack.get(track.id) ?? [];
      const access = evaluateTrackAccess(lc.evaluator, area, track, mods, (mid) => index.contentsByModule.get(mid) ?? []);
      if (access.reason === "unpublished") continue;
      if (lc.scope.role !== "admin" && (!area.isVisible || track.status !== "published")) continue;
      const lockedVisibility = (track.lockedVisibility as "locked" | "hidden" | null) ?? catalogSettings.lockedVisibility;
      if (access.access === "none" && lockedVisibility === "hidden") continue;
      const e = enr.get(track.id);
      const depDone = !track.dependsOnTrackId || enr.get(track.dependsOnTrackId)?.status === "completed";
      items.push({
        id: track.id,
        title: track.title,
        summary: track.summary,
        area: { id: area.id, name: area.name, slug: area.slug, color: area.color, icon: area.icon },
        level: track.level,
        mode: track.mode,
        specialty: track.specialty,
        jobTitleIds: index.jobTitlesByTrack.get(track.id) ?? [],
        moduleCount: publishedModuleCount(index, track.id),
        estimatedMinutes: trackEstimatedMinutes(index, track),
        coverColor: track.coverColor ?? area.color,
        hasCover: !!track.coverFileId,
        prerequisites: track.prerequisitesText,
        dependsOn: track.dependsOnTrackId ? { id: track.dependsOnTrackId, title: titles.get(track.dependsOnTrackId) ?? "" } : null,
        isRampUp: track.isRampUp,
        rampDays: track.rampDays,
        status: track.status,
        access: access.access,
        availability: access.access === "none" ? "locked" : track.mode === "dependente" && !depDone && lc.scope.role !== "admin" ? "blocked" : "available",
        isMandatory: track.mode === "obrigatoria" || !!e?.isMandatory,
        progress: e ? { status: e.status, percent: e.progressPercent, dueDate: e.dueDate } : { status: "not_started", percent: 0, dueDate: null },
      });
    }
    return { lc, index, items, catalogSettings };
  }

  app.get("/api/catalog/areas", async (req) => {
    const { index, items } = await catalogFor(req);
    return index.areas
      .filter((a) => a.isVisible || req.auth!.user.role === "admin")
      .map((a) => {
        const own = items.filter((t) => t.area.id === a.id);
        return {
          id: a.id,
          slug: a.slug,
          code: a.code,
          name: a.name,
          description: a.description,
          icon: a.icon,
          color: a.color,
          isVisible: a.isVisible,
          trackCount: own.length,
          availableCount: own.filter((t) => t.access !== "none").length,
          completedCount: own.filter((t) => t.progress.status === "completed").length,
          inProgressCount: own.filter((t) => t.progress.status !== "completed" && t.progress.status !== "not_started").length,
        };
      });
  });

  app.get("/api/catalog/tracks", async (req) => {
    const q = parse(
      z.object({
        area: z.string().max(100).optional(),
        level: z.enum(LEVELS).optional(),
        mode: z.enum(TRACK_MODES).optional(),
        status: z.enum(LEARNER_TRACK_STATUS).optional(),
        jobTitle: z.string().uuid().optional(),
        specialty: z.string().max(100).optional(),
        required: z.enum(["mandatory", "optional"]).optional(),
        q: z.string().max(100).optional(),
      }),
      req.query,
    );
    const { items, index, catalogSettings } = await catalogFor(req);
    const term = q.q?.trim().toLowerCase();
    const filtered = items.filter((t) => {
      if (q.area && t.area.id !== q.area && t.area.slug !== q.area) return false;
      if (q.level && t.level !== q.level) return false;
      if (q.mode && t.mode !== q.mode) return false;
      if (q.status && t.progress.status !== q.status) return false;
      if (q.jobTitle && !t.jobTitleIds.includes(q.jobTitle)) return false;
      if (q.specialty && t.specialty !== q.specialty) return false;
      if (q.required === "mandatory" && !t.isMandatory) return false;
      if (q.required === "optional" && t.isMandatory) return false;
      if (term && !`${t.title} ${t.summary} ${t.area.name} ${t.specialty}`.toLowerCase().includes(term)) return false;
      return true;
    });
    const jt = await db.select({ id: jobTitles.id, name: jobTitles.name }).from(jobTitles);
    return {
      tracks: filtered,
      filters: {
        areas: index.areas.filter((a) => a.isVisible).map((a) => ({ id: a.id, name: a.name, slug: a.slug })),
        specialties: [...new Set(items.map((t) => t.specialty).filter(Boolean))].sort(),
        jobTitles: jt,
      },
      allowAccessRequests: catalogSettings.allowAccessRequests,
    };
  });

  app.get("/api/tracks/:id", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const lc = await learnerContext(req);
    let t;
    try {
      t = await trackForUser(req, id, lc, { auditDenied: false });
    } catch (err) {
      // Trilha sem autorização: mostra apenas a apresentação, se o catálogo estiver em modo "bloqueado".
      const e = err as { code?: string };
      if (e.code !== "no_access") throw err;
      const [track] = await db.select().from(tracks).where(eq(tracks.id, id));
      const catalogSettings = await settings.get("catalog");
      const visibility = (track?.lockedVisibility as string | null) ?? catalogSettings.lockedVisibility;
      if (!track || visibility === "hidden") throw notFound("Trilha não encontrada.");
      const [pending] = await db
        .select({ id: requests.id })
        .from(requests)
        .where(and(eq(requests.requesterId, lc.user.id), eq(requests.resourceId, id), eq(requests.status, "open")));
      return {
        locked: true,
        track: { id: track.id, title: track.title, summary: track.summary, description: track.description, level: track.level, mode: track.mode },
        canRequestAccess: catalogSettings.allowAccessRequests,
        pendingRequest: !!pending,
      };
    }
    const s = t.structure;
    const [enrollment] = await db.select().from(enrollments).where(and(eq(enrollments.userId, lc.user.id), eq(enrollments.trackId, id)));
    const [cert] = await db.select().from(certificates).where(and(eq(certificates.userId, lc.user.id), eq(certificates.trackId, id)));
    const dep = s.track.dependsOnTrackId ? (await db.select({ id: tracks.id, title: tracks.title }).from(tracks).where(eq(tracks.id, s.track.dependsOnTrackId)))[0] : null;
    const jt = await db.select({ id: jobTitles.id, name: jobTitles.name }).from(jobTitles);
    return {
      locked: false,
      preview: t.preview,
      partial: t.access.access === "partial",
      track: {
        id: s.track.id,
        title: s.track.title,
        summary: s.track.summary,
        description: s.track.description,
        objectives: s.track.objectives,
        prerequisites: s.track.prerequisitesText,
        specialty: s.track.specialty,
        level: s.track.level,
        mode: s.track.mode,
        status: s.track.status,
        ownerName: s.track.ownerName,
        isRampUp: s.track.isRampUp,
        rampDays: s.track.rampDays,
        requiresLeaderValidation: s.track.requiresLeaderValidation,
        certificateEnabled: s.track.certificateEnabled,
        coverColor: s.track.coverColor ?? s.area.color,
        hasCover: !!s.track.coverFileId,
        dependsOn: dep ?? null,
        jobTitles: jt,
      },
      area: { id: s.area.id, name: s.area.name, slug: s.area.slug, color: s.area.color, icon: s.area.icon },
      enrollment: enrollment
        ? { isMandatory: enrollment.isMandatory, dueDate: enrollment.dueDate, source: enrollment.source, startedAt: enrollment.startedAt, completedAt: enrollment.completedAt }
        : null,
      isMandatory: s.track.mode === "obrigatoria" || !!enrollment?.isMandatory,
      certificate: cert ? { code: cert.code, issuedAt: cert.issuedAt } : null,
      trackLock: t.trackLock,
      view: t.view,
    };
  });

  app.post("/api/tracks/:id/start", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const t = await trackForUser(req, id);
    if (t.trackLock.locked) throw forbidden(t.trackLock.reason ?? "Trilha bloqueada.", "locked");
    await db
      .insert(enrollments)
      .values({ userId: t.lc.user.id, trackId: id, source: "self", startedAt: new Date(), status: "in_progress", lastActivityAt: new Date() })
      .onConflictDoNothing();
    await audit(req, "track.started", { targetType: "track", targetId: id });
    await refreshEnrollment(app.ctx, t.lc.user.id, id);
    return { ok: true, next: t.view.next };
  });

  app.get("/api/modules/:id", async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const m = await moduleForUser(req, id);
    const idx = m.track.view.modules.findIndex((x) => x.id === id);
    const prev = idx > 0 ? m.track.view.modules[idx - 1] : null;
    const next = idx >= 0 && idx < m.track.view.modules.length - 1 ? m.track.view.modules[idx + 1] : null;
    return {
      preview: m.track.preview,
      module: { ...m.moduleView, requiresPrevious: m.module.requiresPrevious },
      track: { id: m.track.structure.track.id, title: m.track.structure.track.title, areaName: m.area.name, areaColor: m.area.color },
      prev: prev ? { id: prev.id, title: prev.title } : null,
      next: next ? { id: next.id, title: next.title, locked: next.locked } : null,
      trackStatus: m.track.view.status,
    };
  });

  app.get("/api/job-titles", async () => {
    return db.select({ id: jobTitles.id, name: jobTitles.name }).from(jobTitles);
  });
}
