import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { CONTENT_TYPES, LEVELS, PRACTICE_STAGES, PUBLICATION_STATUS, TRACK_MODES, DELIVERABLE_TYPES, userCode, type PublicationStatus } from "../../../shared/domain.js";
import { assertCanManageArea, canManageArea, type UserScope } from "../../authz/policy.js";
import {
  assessments,
  contents,
  contentVersions,
  documentPages,
  enrollments,
  entityRevisions,
  files,
  jobTitles,
  knowledgeAreas,
  modules,
  practicalActivities,
  questions,
  trackJobTitles,
  tracks,
  users,
} from "../../db/schema.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { audit, requireRole } from "../../lib/http.js";
import { detectImage, readSingleFile } from "../../lib/upload.js";
import { parse } from "../../lib/validate.js";
import { ingestDocument, storePrivateFile } from "../../services/documents/pipeline.js";
import { applyWatermark } from "../../services/documents/watermark.js";
import { notify } from "../../services/notifications.js";
import { recordRevision } from "../../services/revisions.js";
import { managerContext } from "../../services/scope.js";

const idParams = z.object({ id: z.string().uuid() });
const statusBody = z.object({ status: z.enum(PUBLICATION_STATUS) });
const reorderBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) });
const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

/** Publicar exige permissão de publicação; as demais mudanças de status exigem edição. */
function assertStatusChange(scope: UserScope, areaId: string, status: PublicationStatus) {
  assertCanManageArea(scope, areaId, status === "published" ? "publish" : "edit");
}

export async function adminContentRoutes(app: FastifyInstance) {
  const { db, storage } = app.ctx;

  async function trackArea(trackId: string) {
    const [t] = await db.select().from(tracks).where(eq(tracks.id, trackId));
    if (!t) throw notFound("Trilha não encontrada.");
    return t;
  }
  async function moduleWithTrack(moduleId: string) {
    const [row] = await db.select({ m: modules, t: tracks }).from(modules).innerJoin(tracks, eq(tracks.id, modules.trackId)).where(eq(modules.id, moduleId));
    if (!row) throw notFound("Módulo não encontrado.");
    return row;
  }
  async function contentWithTrack(contentId: string) {
    const [row] = await db
      .select({ c: contents, m: modules, t: tracks })
      .from(contents)
      .innerJoin(modules, eq(modules.id, contents.moduleId))
      .innerJoin(tracks, eq(tracks.id, modules.trackId))
      .where(eq(contents.id, contentId));
    if (!row) throw notFound("Conteúdo não encontrado.");
    return row;
  }

  // ------------------------------------------------------------------ Árvore
  app.get("/api/admin/content/tree", async (req) => {
    const { scope } = await managerContext(req);
    const areas = await db.select().from(knowledgeAreas).orderBy(asc(knowledgeAreas.sortOrder), asc(knowledgeAreas.name));
    const trackRows = await db.select().from(tracks).orderBy(asc(tracks.sortOrder), asc(tracks.title));
    const modCounts = await db.select({ trackId: modules.trackId, n: count() }).from(modules).groupBy(modules.trackId);
    const enrCounts = await db.select({ trackId: enrollments.trackId, n: count() }).from(enrollments).groupBy(enrollments.trackId);
    return areas
      .filter((a) => canManageArea(scope, a.id, "view"))
      .map((a) => ({
        ...a,
        canEdit: canManageArea(scope, a.id, "edit"),
        canPublish: canManageArea(scope, a.id, "publish"),
        tracks: trackRows
          .filter((t) => t.areaId === a.id)
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            mode: t.mode,
            level: t.level,
            sortOrder: t.sortOrder,
            modules: Number(modCounts.find((m) => m.trackId === t.id)?.n ?? 0),
            enrollments: Number(enrCounts.find((e) => e.trackId === t.id)?.n ?? 0),
            updatedAt: t.updatedAt,
          })),
      }));
  });

  // ------------------------------------------------------------------ Áreas (somente administrador)
  const areaBody = z.object({
    name: z.string().trim().min(2).max(120),
    code: z.string().trim().max(10).nullable().optional(),
    description: z.string().trim().max(2000).default(""),
    icon: z.string().trim().max(40).default("BookOpen"),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1FB873"),
    isVisible: z.boolean().default(true),
    settings: z
      .object({
        wordsPerMinute: z.number().int().min(80).max(600).optional(),
        passingScore: z.number().int().min(0).max(100).optional(),
        commentsEnabled: z.boolean().optional(),
      })
      .default({}),
  });

  app.post("/api/admin/areas", async (req) => {
    const admin = requireRole(req, "admin");
    const body = parse(areaBody, req.body);
    let slug = slugify(body.name) || "area";
    const [dup] = await db.select({ id: knowledgeAreas.id }).from(knowledgeAreas).where(eq(knowledgeAreas.slug, slug));
    if (dup) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(knowledgeAreas);
    const [row] = await db.insert(knowledgeAreas).values({ ...body, code: body.code ?? null, slug, sortOrder: Number(n) }).returning();
    await recordRevision(db, "area", row!.id, "created", row!, admin.id);
    await audit(req, "area.created", { targetType: "area", targetId: row!.id, metadata: { name: body.name } });
    return row;
  });

  app.patch("/api/admin/areas/:id", async (req) => {
    const admin = requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const body = parse(areaBody.partial(), req.body);
    const [row] = await db.update(knowledgeAreas).set({ ...body, updatedAt: new Date() }).where(eq(knowledgeAreas.id, id)).returning();
    if (!row) throw notFound();
    await recordRevision(db, "area", id, "updated", row, admin.id);
    await audit(req, "area.updated", { targetType: "area", targetId: id, metadata: body });
    return row;
  });

  app.delete("/api/admin/areas/:id", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(tracks).where(eq(tracks.areaId, id));
    if (Number(n) > 0) throw badRequest("A área possui trilhas. Oculte a área ou mova/arquive as trilhas antes de excluir.");
    await db.delete(knowledgeAreas).where(eq(knowledgeAreas.id, id));
    await audit(req, "area.deleted", { targetType: "area", targetId: id });
    return { ok: true };
  });

  app.post("/api/admin/areas/reorder", async (req) => {
    requireRole(req, "admin");
    const { ids } = parse(reorderBody, req.body);
    for (const [i, id] of ids.entries()) await db.update(knowledgeAreas).set({ sortOrder: i }).where(eq(knowledgeAreas.id, id));
    await audit(req, "area.reordered");
    return { ok: true };
  });

  // ------------------------------------------------------------------ Trilhas
  const trackBody = z.object({
    areaId: z.string().uuid(),
    title: z.string().trim().min(3).max(200),
    summary: z.string().trim().max(400).default(""),
    description: z.string().trim().max(10_000).default(""),
    objectives: z.string().trim().max(5000).default(""),
    prerequisitesText: z.string().trim().max(2000).default(""),
    specialty: z.string().trim().max(80).default(""),
    level: z.enum(LEVELS).default("basico"),
    mode: z.enum(TRACK_MODES).default("opcional"),
    dependsOnTrackId: z.string().uuid().nullable().optional(),
    estimatedMinutesOverride: z.number().int().min(1).max(100_000).nullable().optional(),
    coverColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    lockedVisibility: z.enum(["locked", "hidden"]).nullable().optional(),
    requiresLeaderValidation: z.boolean().default(false),
    certificateEnabled: z.boolean().default(false),
    commentsEnabled: z.boolean().default(true),
    isRampUp: z.boolean().default(false),
    rampDays: z.number().int().min(1).max(90).nullable().optional(),
    ownerName: z.string().trim().max(150).default(""),
    jobTitleIds: z.array(z.string().uuid()).max(50).default([]),
  });

  app.post("/api/admin/tracks", async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(trackBody, req.body);
    assertCanManageArea(scope, body.areaId, "edit");
    if (body.mode === "dependente" && !body.dependsOnTrackId) throw badRequest("Escolha a trilha de pré-requisito.");
    const { jobTitleIds, ...values } = body;
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(tracks).where(eq(tracks.areaId, body.areaId));
    const [row] = await db.insert(tracks).values({ ...values, sortOrder: Number(n), createdBy: user.id, status: "draft" }).returning();
    if (jobTitleIds.length) await db.insert(trackJobTitles).values(jobTitleIds.map((jobTitleId) => ({ trackId: row!.id, jobTitleId })));
    await recordRevision(db, "track", row!.id, "created", row!, user.id);
    await audit(req, "track.created", { targetType: "track", targetId: row!.id, metadata: { title: body.title } });
    return row;
  });

  app.get("/api/admin/tracks/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const track = await trackArea(id);
    assertCanManageArea(scope, track.areaId, "view");
    const [area] = await db.select().from(knowledgeAreas).where(eq(knowledgeAreas.id, track.areaId));
    const mods = await db.select().from(modules).where(eq(modules.trackId, id)).orderBy(asc(modules.sortOrder), asc(modules.createdAt));
    const moduleIds = mods.map((m) => m.id);
    const cs = moduleIds.length
      ? await db
          .select({ c: contents, v: contentVersions })
          .from(contents)
          .leftJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
          .where(inArray(contents.moduleId, moduleIds))
          .orderBy(asc(contents.sortOrder))
      : [];
    const latestVersions = cs.length
      ? await db
          .select()
          .from(contentVersions)
          .where(inArray(contentVersions.contentId, cs.map((x) => x.c.id)))
          .orderBy(desc(contentVersions.versionNumber))
      : [];
    const as = await db.select().from(assessments).where(eq(assessments.trackId, id)).orderBy(asc(assessments.sortOrder));
    const qCounts = as.length
      ? await db.select({ assessmentId: questions.assessmentId, n: count() }).from(questions).where(and(inArray(questions.assessmentId, as.map((a) => a.id)), eq(questions.isActive, true))).groupBy(questions.assessmentId)
      : [];
    const acts = await db.select().from(practicalActivities).where(eq(practicalActivities.trackId, id)).orderBy(asc(practicalActivities.sortOrder));
    const jt = await db.select({ jobTitleId: trackJobTitles.jobTitleId }).from(trackJobTitles).where(eq(trackJobTitles.trackId, id));
    const others = await db.select({ id: tracks.id, title: tracks.title }).from(tracks).where(ne(tracks.id, id)).orderBy(asc(tracks.title));
    const allJobTitles = await db.select({ id: jobTitles.id, name: jobTitles.name }).from(jobTitles).orderBy(asc(jobTitles.name));
    return {
      track: { ...track, jobTitleIds: jt.map((x) => x.jobTitleId) },
      area,
      permissions: { canEdit: canManageArea(scope, track.areaId, "edit"), canPublish: canManageArea(scope, track.areaId, "publish") },
      modules: mods.map((m) => ({
        ...m,
        contents: cs
          .filter((x) => x.c.moduleId === m.id)
          .map((x) => {
            const latest = latestVersions.find((v) => v.contentId === x.c.id);
            return {
              ...x.c,
              currentVersion: x.v ? { id: x.v.id, number: x.v.versionNumber, pageCount: x.v.pageCount, wordCount: x.v.wordCount, processingStatus: x.v.processingStatus } : null,
              latestVersion: latest ? { id: latest.id, number: latest.versionNumber, processingStatus: latest.processingStatus, processingError: latest.processingError } : null,
            };
          }),
        assessments: as.filter((a) => a.moduleId === m.id).map((a) => ({ ...a, questions: Number(qCounts.find((q) => q.assessmentId === a.id)?.n ?? 0) })),
        activities: acts.filter((a) => a.moduleId === m.id),
      })),
      finalAssessments: as.filter((a) => a.moduleId === null).map((a) => ({ ...a, questions: Number(qCounts.find((q) => q.assessmentId === a.id)?.n ?? 0) })),
      otherTracks: others,
      jobTitles: allJobTitles,
    };
  });

  app.patch("/api/admin/tracks/:id", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const body = parse(trackBody.partial(), req.body);
    const track = await trackArea(id);
    assertCanManageArea(scope, track.areaId, "edit");
    if (body.areaId && body.areaId !== track.areaId) assertCanManageArea(scope, body.areaId, "edit");
    if (body.dependsOnTrackId === id) throw badRequest("A trilha não pode depender de si mesma.");
    const { jobTitleIds, ...values } = body;
    const [row] = await db
      .update(tracks)
      .set({ ...values, version: track.version + 1, updatedAt: new Date() })
      .where(eq(tracks.id, id))
      .returning();
    if (jobTitleIds) {
      await db.delete(trackJobTitles).where(eq(trackJobTitles.trackId, id));
      if (jobTitleIds.length) await db.insert(trackJobTitles).values(jobTitleIds.map((jobTitleId) => ({ trackId: id, jobTitleId })));
    }
    await recordRevision(db, "track", id, "updated", row!, user.id);
    await audit(req, "track.updated", { targetType: "track", targetId: id, metadata: { fields: Object.keys(body) } });
    return row;
  });

  app.post("/api/admin/tracks/:id/status", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { status } = parse(statusBody, req.body);
    const track = await trackArea(id);
    assertStatusChange(scope, track.areaId, status);
    if (track.status === "published" && status !== "published") assertCanManageArea(scope, track.areaId, "publish");
    const [row] = await db
      .update(tracks)
      .set({ status, publishedAt: status === "published" ? track.publishedAt ?? new Date() : track.publishedAt, updatedAt: new Date() })
      .where(eq(tracks.id, id))
      .returning();
    await recordRevision(db, "track", id, `status:${status}`, row!, user.id);
    await audit(req, "track.status_changed", { targetType: "track", targetId: id, metadata: { from: track.status, to: status } });
    return row;
  });

  app.delete("/api/admin/tracks/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const track = await trackArea(id);
    assertCanManageArea(scope, track.areaId, "publish");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(enrollments).where(eq(enrollments.trackId, id));
    if (track.status !== "draft" || Number(n) > 0) throw badRequest("Só é possível excluir rascunhos sem matrículas. Arquive a trilha para preservar o histórico.");
    await db.delete(tracks).where(eq(tracks.id, id));
    await audit(req, "track.deleted", { targetType: "track", targetId: id, metadata: { title: track.title } });
    return { ok: true };
  });

  app.post("/api/admin/tracks/reorder", async (req) => {
    const { scope } = await managerContext(req);
    const { ids } = parse(reorderBody, req.body);
    const rows = await db.select({ id: tracks.id, areaId: tracks.areaId }).from(tracks).where(inArray(tracks.id, ids));
    for (const r of rows) assertCanManageArea(scope, r.areaId, "edit");
    for (const [i, id] of ids.entries()) await db.update(tracks).set({ sortOrder: i }).where(eq(tracks.id, id));
    return { ok: true };
  });

  async function uploadCover(req: FastifyRequest, userId: string) {
    const file = await readSingleFile(req, 3 * 1024 * 1024);
    const img = detectImage(file.buffer);
    if (!img) throw badRequest("Envie uma imagem PNG, JPEG ou WebP.");
    const stored = await storePrivateFile(app.ctx, { buffer: file.buffer, originalName: file.filename, mimeType: img.mime, purpose: "cover", userId, extension: img.ext });
    return stored.id;
  }

  app.post("/api/admin/tracks/:id/cover", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const track = await trackArea(id);
    assertCanManageArea(scope, track.areaId, "edit");
    const fileId = await uploadCover(req, user.id);
    await db.update(tracks).set({ coverFileId: fileId, updatedAt: new Date() }).where(eq(tracks.id, id));
    await audit(req, "track.cover_updated", { targetType: "track", targetId: id });
    return { fileId };
  });

  // ------------------------------------------------------------------ Módulos
  const moduleBody = z.object({
    trackId: z.string().uuid(),
    code: z.string().trim().max(20).nullable().optional(),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).default(""),
    objectives: z.string().trim().max(5000).default(""),
    requiresPrevious: z.boolean().default(false),
    estimatedMinutesOverride: z.number().int().min(1).max(100_000).nullable().optional(),
  });

  app.post("/api/admin/modules", async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(moduleBody, req.body);
    const track = await trackArea(body.trackId);
    assertCanManageArea(scope, track.areaId, "edit");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(modules).where(eq(modules.trackId, body.trackId));
    const [row] = await db.insert(modules).values({ ...body, code: body.code ?? null, sortOrder: Number(n) }).returning();
    await recordRevision(db, "module", row!.id, "created", row!, user.id);
    await audit(req, "module.created", { targetType: "module", targetId: row!.id });
    return row;
  });

  app.patch("/api/admin/modules/:id", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const body = parse(moduleBody.partial().omit({ trackId: true }), req.body);
    const { t } = await moduleWithTrack(id);
    assertCanManageArea(scope, t.areaId, "edit");
    const [row] = await db.update(modules).set({ ...body, updatedAt: new Date() }).where(eq(modules.id, id)).returning();
    await recordRevision(db, "module", id, "updated", row!, user.id);
    await audit(req, "module.updated", { targetType: "module", targetId: id });
    return row;
  });

  app.post("/api/admin/modules/:id/status", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { status } = parse(statusBody, req.body);
    const { m, t } = await moduleWithTrack(id);
    assertStatusChange(scope, t.areaId, status);
    if (m.status === "published" && status !== "published") assertCanManageArea(scope, t.areaId, "publish");
    const [row] = await db.update(modules).set({ status, updatedAt: new Date() }).where(eq(modules.id, id)).returning();
    await recordRevision(db, "module", id, `status:${status}`, row!, user.id);
    await audit(req, "module.status_changed", { targetType: "module", targetId: id, metadata: { from: m.status, to: status } });
    return row;
  });

  app.delete("/api/admin/modules/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { m, t } = await moduleWithTrack(id);
    assertCanManageArea(scope, t.areaId, "publish");
    if (m.status !== "draft") throw badRequest("Só é possível excluir módulos em rascunho. Arquive para preservar o histórico.");
    await db.delete(modules).where(eq(modules.id, id));
    await audit(req, "module.deleted", { targetType: "module", targetId: id, metadata: { title: m.title } });
    return { ok: true };
  });

  app.post("/api/admin/modules/reorder", async (req) => {
    const { scope } = await managerContext(req);
    const { ids } = parse(reorderBody, req.body);
    const rows = await db.select({ id: modules.id, areaId: tracks.areaId }).from(modules).innerJoin(tracks, eq(tracks.id, modules.trackId)).where(inArray(modules.id, ids));
    for (const r of rows) assertCanManageArea(scope, r.areaId, "edit");
    for (const [i, id] of ids.entries()) await db.update(modules).set({ sortOrder: i }).where(eq(modules.id, id));
    return { ok: true };
  });

  // ------------------------------------------------------------------ Conteúdos
  const contentBody = z.object({
    moduleId: z.string().uuid(),
    type: z.enum(CONTENT_TYPES).default("document"),
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(5000).default(""),
    learningObjective: z.string().trim().max(2000).default(""),
    level: z.enum(LEVELS).nullable().optional(),
    ownerName: z.string().trim().max(150).default(""),
    isRequired: z.boolean().default(true),
    allowDownload: z.boolean().default(false),
    allowTextMode: z.boolean().nullable().optional(),
    commentsEnabled: z.boolean().nullable().optional(),
    estimatedMinutesOverride: z.number().int().min(1).max(100_000).nullable().optional(),
    readingFactor: z.number().min(0.5).max(4).default(1),
    dependsOnContentId: z.string().uuid().nullable().optional(),
    externalUrl: z
      .string()
      .trim()
      .url()
      .refine((v) => /^https:\/\//i.test(v), "Use um link https.")
      .nullable()
      .optional(),
    bodyText: z.string().max(100_000).nullable().optional(),
  });

  app.post("/api/admin/contents", async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(contentBody, req.body);
    const { t } = await moduleWithTrack(body.moduleId);
    assertCanManageArea(scope, t.areaId, "edit");
    if (body.allowDownload) assertCanManageArea(scope, t.areaId, "publish");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(contents).where(eq(contents.moduleId, body.moduleId));
    const [row] = await db.insert(contents).values({ ...body, sortOrder: Number(n), createdBy: user.id, status: "draft" }).returning();
    await recordRevision(db, "content", row!.id, "created", row!, user.id);
    await audit(req, "content.created", { targetType: "content", targetId: row!.id, metadata: { title: body.title, type: body.type } });
    return row;
  });

  app.get("/api/admin/contents/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { c, m, t } = await contentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "view");
    const versions = await db
      .select({ v: contentVersions, file: files, author: users.name })
      .from(contentVersions)
      .leftJoin(files, eq(files.id, contentVersions.fileId))
      .leftJoin(users, eq(users.id, contentVersions.createdBy))
      .where(eq(contentVersions.contentId, id))
      .orderBy(desc(contentVersions.versionNumber));
    const siblings = await db.select({ id: contents.id, title: contents.title }).from(contents).where(and(eq(contents.moduleId, m.id), ne(contents.id, id)));
    return {
      content: c,
      module: { id: m.id, title: m.title },
      track: { id: t.id, title: t.title, areaId: t.areaId },
      permissions: { canEdit: canManageArea(scope, t.areaId, "edit"), canPublish: canManageArea(scope, t.areaId, "publish") },
      versions: versions.map(({ v, file, author }) => ({
        id: v.id,
        number: v.versionNumber,
        isCurrent: v.id === c.currentVersionId,
        pageCount: v.pageCount,
        wordCount: v.wordCount,
        processingStatus: v.processingStatus,
        processingError: v.processingError,
        changeNotes: v.changeNotes,
        isMajor: v.isMajor,
        createdAt: v.createdAt,
        publishedAt: v.publishedAt,
        author,
        file: file ? { name: file.originalName, size: file.sizeBytes, sha256: file.sha256, scanStatus: file.scanStatus, scanDetail: file.scanDetail } : null,
      })),
      siblings,
    };
  });

  app.patch("/api/admin/contents/:id", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const body = parse(contentBody.partial().omit({ moduleId: true }), req.body);
    const { t } = await contentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "edit");
    if (body.allowDownload) assertCanManageArea(scope, t.areaId, "publish");
    if (body.dependsOnContentId === id) throw badRequest("O conteúdo não pode depender de si mesmo.");
    const [row] = await db.update(contents).set({ ...body, updatedAt: new Date() }).where(eq(contents.id, id)).returning();
    await recordRevision(db, "content", id, "updated", row!, user.id);
    await audit(req, "content.updated", { targetType: "content", targetId: id, metadata: { fields: Object.keys(body) } });
    return row;
  });

  app.post("/api/admin/contents/:id/status", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { status } = parse(statusBody, req.body);
    const { c, t } = await contentWithTrack(id);
    assertStatusChange(scope, t.areaId, status);
    if (c.status === "published" && status !== "published") assertCanManageArea(scope, t.areaId, "publish");
    if (status === "published" && c.type === "document" && !c.currentVersionId) throw badRequest("Envie o arquivo e aguarde o processamento antes de publicar.");
    const firstPublish = status === "published" && !c.publishedAt;
    const [row] = await db
      .update(contents)
      .set({ status, publishedAt: status === "published" ? c.publishedAt ?? new Date() : c.publishedAt, updatedAt: new Date() })
      .where(eq(contents.id, id))
      .returning();
    await recordRevision(db, "content", id, `status:${status}`, row!, user.id);
    await audit(req, "content.status_changed", { targetType: "content", targetId: id, metadata: { from: c.status, to: status } });
    if (firstPublish && t.status === "published") {
      const enrolled = await db.select({ userId: enrollments.userId }).from(enrollments).where(eq(enrollments.trackId, t.id));
      for (const e of enrolled) {
        await notify(app.ctx, {
          userId: e.userId,
          type: "content_published",
          title: "Novo conteúdo disponível",
          body: `“${c.title}” foi publicado na trilha “${t.title}”.`,
          link: `/conteudos/${id}`,
          dedupeKey: `published:${id}`,
        });
      }
    }
    return row;
  });

  app.delete("/api/admin/contents/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { c, t } = await contentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "publish");
    if (c.status !== "draft") throw badRequest("Só é possível excluir conteúdos em rascunho. Arquive para preservar o histórico.");
    await db.delete(contents).where(eq(contents.id, id));
    await audit(req, "content.deleted", { targetType: "content", targetId: id, metadata: { title: c.title } });
    return { ok: true };
  });

  app.post("/api/admin/contents/reorder", async (req) => {
    const { scope } = await managerContext(req);
    const { ids } = parse(reorderBody, req.body);
    const rows = await db
      .select({ id: contents.id, areaId: tracks.areaId })
      .from(contents)
      .innerJoin(modules, eq(modules.id, contents.moduleId))
      .innerJoin(tracks, eq(tracks.id, modules.trackId))
      .where(inArray(contents.id, ids));
    for (const r of rows) assertCanManageArea(scope, r.areaId, "edit");
    for (const [i, id] of ids.entries()) await db.update(contents).set({ sortOrder: i }).where(eq(contents.id, id));
    return { ok: true };
  });

  // Upload de nova versão (PDF ou DOCX). Campos de texto antes do arquivo: changeNotes, isMajor.
  app.post("/api/admin/contents/:id/versions", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { c, t } = await contentWithTrack(id);
    assertCanManageArea(scope, t.areaId, "edit");
    if (c.type !== "document") throw badRequest("Somente conteúdos do tipo apostila recebem arquivo.");
    const security = await app.ctx.settings.get("security");
    const file = await readSingleFile(req, security.maxUploadMb * 1024 * 1024);
    const result = await ingestDocument(app.ctx, {
      buffer: file.buffer,
      filename: file.filename,
      contentId: id,
      userId: user.id,
      changeNotes: (file.fields.changeNotes ?? "").slice(0, 2000),
      isMajor: file.fields.isMajor !== "false",
    });
    await audit(req, "content.version_uploaded", {
      targetType: "content",
      targetId: id,
      metadata: { version: result.version.versionNumber, file: file.filename, scan: result.scan.status, flags: result.flags },
    });
    return { versionId: result.version.id, number: result.version.versionNumber, scan: result.scan, flags: result.flags };
  });

  /** Torna uma versão processada a versão atual. Atualização relevante de apostila obrigatória gera aviso. */
  app.post("/api/admin/contents/:id/versions/:versionId/activate", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id, versionId } = parse(z.object({ id: z.string().uuid(), versionId: z.string().uuid() }), req.params);
    const { c, t } = await contentWithTrack(id);
    assertCanManageArea(scope, t.areaId, c.status === "published" ? "publish" : "edit");
    const [v] = await db.select().from(contentVersions).where(and(eq(contentVersions.id, versionId), eq(contentVersions.contentId, id)));
    if (!v) throw notFound("Versão não encontrada.");
    if (v.processingStatus !== "ready") throw badRequest("A versão ainda não foi processada.");
    await db.update(contents).set({ currentVersionId: versionId, updatedAt: new Date() }).where(eq(contents.id, id));
    await db.update(contentVersions).set({ publishedAt: v.publishedAt ?? new Date() }).where(eq(contentVersions.id, versionId));
    await recordRevision(db, "content", id, `version:${v.versionNumber}`, { versionId, number: v.versionNumber, changeNotes: v.changeNotes }, user.id);
    await audit(req, "content.version_activated", { targetType: "content", targetId: id, metadata: { version: v.versionNumber } });
    if (c.status === "published" && v.isMajor && c.isRequired && c.currentVersionId && c.currentVersionId !== versionId) {
      const enrolled = await db.select({ userId: enrollments.userId }).from(enrollments).where(eq(enrollments.trackId, t.id));
      for (const e of enrolled) {
        await notify(app.ctx, {
          userId: e.userId,
          type: "content_updated",
          title: "Apostila atualizada",
          body: `“${c.title}” recebeu a versão ${v.versionNumber}${v.changeNotes ? `: ${v.changeNotes.slice(0, 140)}` : "."}`,
          link: `/conteudos/${id}`,
          dedupeKey: `updated:${versionId}`,
        });
      }
    }
    return { ok: true };
  });

  /** Pré-visualização de qualquer versão (com marca d'água de quem está revisando). */
  app.get("/api/admin/versions/:versionId/pages/:n", async (req, reply) => {
    const { user, scope } = await managerContext(req);
    const { versionId, n } = parse(z.object({ versionId: z.string().uuid(), n: z.coerce.number().int().min(1).max(5000) }), req.params);
    const [v] = await db.select().from(contentVersions).where(eq(contentVersions.id, versionId));
    if (!v) throw notFound();
    const { t } = await contentWithTrack(v.contentId);
    assertCanManageArea(scope, t.areaId, "view");
    const [page] = await db.select().from(documentPages).where(and(eq(documentPages.versionId, versionId), eq(documentPages.pageNumber, n)));
    if (!page) throw notFound();
    const raw = await storage.get(page.imageKey);
    const [u] = await db.select({ seq: users.seq }).from(users).where(eq(users.id, user.id));
    const image = await applyWatermark(raw, {
      name: user.name,
      code: userCode(u?.seq ?? 0),
      date: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      session: "revisao",
    });
    reply.header("Content-Type", "image/webp").header("Cache-Control", "no-store, private");
    return reply.send(image);
  });

  /** Download do original: apenas administradores, sempre auditado. */
  app.get("/api/admin/versions/:versionId/original", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    requireRole(req, "admin");
    const { versionId } = parse(z.object({ versionId: z.string().uuid() }), req.params);
    const [v] = await db.select().from(contentVersions).where(eq(contentVersions.id, versionId));
    const [file] = v?.fileId ? await db.select().from(files).where(eq(files.id, v.fileId)) : [];
    if (!v || !file) throw notFound();
    const data = await storage.get(file.storageKey);
    await audit(req, "content.original_downloaded", { targetType: "content", targetId: v.contentId, metadata: { version: v.versionNumber } });
    reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="original-v${v.versionNumber}.pdf"`);
    return reply.send(data);
  });

  // ------------------------------------------------------------------ Atividades práticas
  const activityBody = z.object({
    moduleId: z.string().uuid(),
    title: z.string().trim().min(2).max(200),
    instructions: z.string().trim().max(10_000).default(""),
    stage: z.enum(PRACTICE_STAGES).default("demonstrate"),
    deliverable: z.enum(DELIVERABLE_TYPES).default("text"),
    competency: z.string().trim().max(300).default(""),
    requiresValidation: z.boolean().default(true),
    isRequired: z.boolean().default(true),
  });

  app.post("/api/admin/activities", async (req) => {
    const { user, scope } = await managerContext(req);
    const body = parse(activityBody, req.body);
    const { m, t } = await moduleWithTrack(body.moduleId);
    assertCanManageArea(scope, t.areaId, "edit");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(practicalActivities).where(eq(practicalActivities.moduleId, m.id));
    const [row] = await db.insert(practicalActivities).values({ ...body, trackId: t.id, sortOrder: Number(n), status: "draft" }).returning();
    await recordRevision(db, "activity", row!.id, "created", row!, user.id);
    await audit(req, "activity.created", { targetType: "activity", targetId: row!.id });
    return row;
  });

  async function activityWithTrack(id: string) {
    const [row] = await db.select({ a: practicalActivities, t: tracks }).from(practicalActivities).innerJoin(tracks, eq(tracks.id, practicalActivities.trackId)).where(eq(practicalActivities.id, id));
    if (!row) throw notFound("Atividade não encontrada.");
    return row;
  }

  app.patch("/api/admin/activities/:id", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const body = parse(activityBody.partial().omit({ moduleId: true }), req.body);
    const { t } = await activityWithTrack(id);
    assertCanManageArea(scope, t.areaId, "edit");
    const [row] = await db.update(practicalActivities).set({ ...body, updatedAt: new Date() }).where(eq(practicalActivities.id, id)).returning();
    await recordRevision(db, "activity", id, "updated", row!, user.id);
    return row;
  });

  app.post("/api/admin/activities/:id/status", async (req) => {
    const { user, scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { status } = parse(statusBody, req.body);
    const { a, t } = await activityWithTrack(id);
    assertStatusChange(scope, t.areaId, status);
    const [row] = await db.update(practicalActivities).set({ status, updatedAt: new Date() }).where(eq(practicalActivities.id, id)).returning();
    await recordRevision(db, "activity", id, `status:${status}`, row!, user.id);
    await audit(req, "activity.status_changed", { targetType: "activity", targetId: id, metadata: { from: a.status, to: status } });
    return row;
  });

  app.delete("/api/admin/activities/:id", async (req) => {
    const { scope } = await managerContext(req);
    const { id } = parse(idParams, req.params);
    const { a, t } = await activityWithTrack(id);
    assertCanManageArea(scope, t.areaId, "publish");
    if (a.status !== "draft") throw badRequest("Só é possível excluir atividades em rascunho.");
    await db.delete(practicalActivities).where(eq(practicalActivities.id, id));
    return { ok: true };
  });

  // ------------------------------------------------------------------ Histórico
  app.get("/api/admin/revisions", async (req) => {
    const { scope } = await managerContext(req);
    const q = parse(z.object({ entityType: z.string().max(40), entityId: z.string().uuid() }), req.query);
    if (scope.role !== "admin") {
      // Líderes veem o histórico apenas de itens das suas áreas.
      const areaOf = async () => {
        if (q.entityType === "track") return (await trackArea(q.entityId)).areaId;
        if (q.entityType === "module") return (await moduleWithTrack(q.entityId)).t.areaId;
        if (q.entityType === "content") return (await contentWithTrack(q.entityId)).t.areaId;
        return null;
      };
      const areaId = await areaOf().catch(() => null);
      if (!areaId || !canManageArea(scope, areaId, "view")) throw forbidden();
    }
    const rows = await db
      .select({ r: entityRevisions, author: users.name })
      .from(entityRevisions)
      .leftJoin(users, eq(users.id, entityRevisions.changedBy))
      .where(and(eq(entityRevisions.entityType, q.entityType), eq(entityRevisions.entityId, q.entityId)))
      .orderBy(desc(entityRevisions.changedAt))
      .limit(100);
    return rows.map(({ r, author }) => ({ id: r.id, action: r.action, changedAt: r.changedAt, author, snapshot: r.snapshot }));
  });
}
