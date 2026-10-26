import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LIBRARY_TYPES, REQUEST_TYPES } from "../../shared/domain.js";
import { files, knowledgeAreas, leaderAreas, libraryItems, notifications, requests, tracks, users } from "../db/schema.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { audit, currentUser } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { notifyMany } from "../services/notifications.js";
import { deadlineReminders } from "./dashboard.js";

const idParams = z.object({ id: z.string().uuid() });

export async function communityRoutes(app: FastifyInstance) {
  const { db, settings, storage } = app.ctx;

  // ------------------------------------------------------------------ Biblioteca
  app.get("/api/library", async (req) => {
    currentUser(req);
    const q = parse(z.object({ type: z.enum(LIBRARY_TYPES).optional(), category: z.string().max(100).optional(), q: z.string().max(100).optional() }), req.query);
    const conds = [eq(libraryItems.status, "published")];
    if (q.type) conds.push(eq(libraryItems.type, q.type));
    if (q.category) conds.push(eq(libraryItems.category, q.category));
    if (q.q?.trim()) {
      const term = `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(libraryItems.title, term), ilike(libraryItems.author, term), ilike(libraryItems.theme, term))!);
    }
    const rows = await db
      .select({ item: libraryItems, areaName: knowledgeAreas.name, fileName: files.originalName, fileSize: files.sizeBytes })
      .from(libraryItems)
      .leftJoin(knowledgeAreas, eq(knowledgeAreas.id, libraryItems.areaId))
      .leftJoin(files, eq(files.id, libraryItems.fileId))
      .where(and(...conds))
      .orderBy(asc(libraryItems.sortOrder), asc(libraryItems.title));
    const categories = await db.selectDistinct({ category: libraryItems.category }).from(libraryItems).where(eq(libraryItems.status, "published"));
    return {
      items: rows.map(({ item, areaName, fileName, fileSize }) => ({
        id: item.id,
        title: item.title,
        author: item.author,
        category: item.category,
        theme: item.theme,
        description: item.description,
        level: item.level,
        estimatedMinutes: item.estimatedMinutes,
        type: item.type,
        license: item.license,
        coverColor: item.coverColor,
        coverFileId: item.coverFileId,
        externalUrl: item.externalUrl,
        canDownload: item.allowDownload && !!item.fileId && item.license !== "external_only",
        download: item.allowDownload && item.fileId && item.license !== "external_only" ? { ext: (fileName ?? "").split(".").pop()?.toUpperCase() ?? "", size: fileSize ?? 0 } : null,
        areaName,
      })),
      categories: categories.map((c) => c.category).filter(Boolean).sort(),
    };
  });

  /** Download só de materiais que a empresa pode distribuir (próprios, licenciados ou de licença aberta). */
  app.get("/api/library/:id/file", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    currentUser(req);
    const { id } = parse(idParams, req.params);
    const [item] = await db.select().from(libraryItems).where(and(eq(libraryItems.id, id), eq(libraryItems.status, "published")));
    if (!item || !item.fileId || !item.allowDownload || item.license === "external_only") throw notFound();
    const [file] = await db.select().from(files).where(eq(files.id, item.fileId));
    if (!file) throw notFound();
    const data = await storage.get(file.storageKey);
    await audit(req, "library.download", { targetType: "library_item", targetId: id });
    reply
      .header("Content-Type", file.mimeType)
      .header("Content-Disposition", `attachment; filename="material"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    return reply.send(data);
  });

  // ------------------------------------------------------------------ Notificações
  app.get("/api/notifications", async (req) => {
    const user = currentUser(req);
    await deadlineReminders(app.ctx, user.id);
    const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(60);
    return {
      unread: rows.filter((n) => !n.readAt).length,
      items: rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.readAt, createdAt: n.createdAt })),
    };
  });

  app.post("/api/notifications/:id/read", async (req) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { ok: true };
  });

  app.post("/api/notifications/read-all", async (req) => {
    const user = currentUser(req);
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { ok: true };
  });

  // ------------------------------------------------------------------ Solicitações
  app.post("/api/requests", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const user = currentUser(req);
    const body = parse(
      z.object({
        type: z.enum(REQUEST_TYPES),
        trackId: z.string().uuid().optional(),
        areaId: z.string().uuid().optional(),
        title: z.string().trim().max(200).default(""),
        message: z.string().trim().max(3000).default(""),
      }),
      req.body,
    );
    let areaId = body.areaId ?? null;
    if (body.type === "access") {
      const catalog = await settings.get("catalog");
      if (!catalog.allowAccessRequests) throw forbidden("Solicitações de acesso estão desativadas.");
      if (!body.trackId) throw badRequest("Informe a trilha.");
      const [track] = await db.select().from(tracks).where(and(eq(tracks.id, body.trackId), eq(tracks.status, "published")));
      if (!track) throw notFound("Trilha não encontrada.");
      areaId = track.areaId;
      const [open] = await db
        .select({ id: requests.id })
        .from(requests)
        .where(and(eq(requests.requesterId, user.id), eq(requests.resourceId, body.trackId), eq(requests.status, "open")));
      if (open) return { id: open.id, duplicate: true };
    } else {
      if (user.role === "collaborator" && body.type === "content_creation") throw forbidden("Pedidos de elaboração de conteúdo são feitos por líderes.");
      if (!body.title) throw badRequest("Informe um título para a sugestão.");
    }
    const [row] = await db
      .insert(requests)
      .values({
        type: body.type,
        requesterId: user.id,
        resourceType: body.trackId ? "track" : null,
        resourceId: body.trackId ?? null,
        areaId,
        title: body.title,
        message: body.message,
      })
      .returning();
    await audit(req, "request.created", { targetType: "request", targetId: row!.id, metadata: { type: body.type } });

    // Avisa administradores e líderes da área.
    const admins = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
    const leaders = areaId ? await db.select({ id: leaderAreas.userId }).from(leaderAreas).where(eq(leaderAreas.areaId, areaId)) : [];
    const recipients = [...new Set([...admins.map((a) => a.id), ...leaders.map((l) => l.id)])].filter((id) => id !== user.id);
    await notifyMany(app.ctx, recipients, {
      type: "request_received",
      title: body.type === "access" ? "Nova solicitação de acesso" : "Nova sugestão de conteúdo",
      body: `${user.name}: ${body.title || "solicitação de acesso"}`,
      link: "/lider/solicitacoes",
      dedupeKey: `req:${row!.id}`,
    });
    return { id: row!.id, duplicate: false };
  });

  app.get("/api/requests/mine", async (req) => {
    const user = currentUser(req);
    const rows = await db
      .select({ r: requests, trackTitle: tracks.title })
      .from(requests)
      .leftJoin(tracks, eq(tracks.id, requests.resourceId))
      .where(eq(requests.requesterId, user.id))
      .orderBy(desc(requests.createdAt));
    return rows.map(({ r, trackTitle }) => ({
      id: r.id,
      type: r.type,
      title: r.title || trackTitle || "",
      message: r.message,
      status: r.status,
      resolutionNote: r.resolutionNote,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    }));
  });

  app.get("/api/areas/simple", async (req) => {
    currentUser(req);
    return db
      .select({ id: knowledgeAreas.id, name: knowledgeAreas.name })
      .from(knowledgeAreas)
      .where(eq(knowledgeAreas.isVisible, true))
      .orderBy(asc(knowledgeAreas.sortOrder));
  });

}
