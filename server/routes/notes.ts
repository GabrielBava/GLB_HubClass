import { and, asc, desc, eq, ilike, inArray, isNull, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bookmarks, comments, contents, highlights, modules, notes, tracks, users } from "../db/schema.js";
import { forbidden, notFound } from "../lib/errors.js";
import { audit, currentUser } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { contentForUser } from "../services/access.js";
import { canManageArea, loadScope } from "../authz/policy.js";
import { notify } from "../services/notifications.js";

const idParams = z.object({ id: z.string().uuid() });

/**
 * Anotações, marcadores e destaques são privados: toda consulta filtra pelo usuário logado,
 * e editar/excluir item de outra pessoa responde 404 (sem revelar que o item existe).
 */
export async function notesRoutes(app: FastifyInstance) {
  const { db, settings } = app.ctx;

  // ---------------------------------------------------------------- Anotações
  app.get("/api/notes", async (req) => {
    const user = currentUser(req);
    const q = parse(
      z.object({ contentId: z.string().uuid().optional(), kind: z.enum(["note", "doubt"]).optional(), q: z.string().max(200).optional() }),
      req.query,
    );
    const conds = [eq(notes.userId, user.id)];
    if (q.contentId) conds.push(eq(notes.contentId, q.contentId));
    if (q.kind) conds.push(eq(notes.kind, q.kind));
    if (q.q?.trim()) {
      const term = `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(notes.body, term), ilike(notes.quote, term))!);
    }
    const rows = await db
      .select({ note: notes, contentTitle: contents.title, moduleTitle: modules.title, trackTitle: tracks.title, trackId: tracks.id })
      .from(notes)
      .innerJoin(contents, eq(contents.id, notes.contentId))
      .innerJoin(modules, eq(modules.id, contents.moduleId))
      .innerJoin(tracks, eq(tracks.id, modules.trackId))
      .where(and(...conds))
      .orderBy(desc(notes.updatedAt))
      .limit(500);
    return rows.map((r) => ({
      id: r.note.id,
      contentId: r.note.contentId,
      contentTitle: r.contentTitle,
      moduleTitle: r.moduleTitle,
      trackTitle: r.trackTitle,
      trackId: r.trackId,
      page: r.note.pageNumber,
      quote: r.note.quote,
      body: r.note.body,
      kind: r.note.kind,
      createdAt: r.note.createdAt,
      updatedAt: r.note.updatedAt,
    }));
  });

  app.post("/api/notes", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const body = parse(
      z.object({
        contentId: z.string().uuid(),
        page: z.number().int().min(1).max(5000).nullable().optional(),
        quote: z.string().trim().max(2000).nullable().optional(),
        body: z.string().trim().min(1, "Escreva a anotação.").max(10_000),
        kind: z.enum(["note", "doubt"]).default("note"),
      }),
      req.body,
    );
    const c = await contentForUser(req, body.contentId, { requireUnlocked: false });
    const [row] = await db
      .insert(notes)
      .values({ userId: c.lc.user.id, contentId: body.contentId, pageNumber: body.page ?? null, quote: body.quote ?? null, body: body.body, kind: body.kind })
      .returning();
    return row;
  });

  app.patch("/api/notes/:id", async (req) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({ body: z.string().trim().min(1).max(10_000).optional(), kind: z.enum(["note", "doubt"]).optional() }),
      req.body,
    );
    const [row] = await db
      .update(notes)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
      .returning();
    if (!row) throw notFound("Anotação não encontrada.");
    return row;
  });

  app.delete("/api/notes/:id", async (req) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const rows = await db.delete(notes).where(and(eq(notes.id, id), eq(notes.userId, user.id))).returning({ id: notes.id });
    if (!rows.length) throw notFound("Anotação não encontrada.");
    return { ok: true };
  });

  /** Exclui todas as anotações do próprio usuário (direito de exclusão). */
  app.delete("/api/notes", async (req) => {
    const user = currentUser(req);
    const rows = await db.delete(notes).where(eq(notes.userId, user.id)).returning({ id: notes.id });
    await db.delete(highlights).where(eq(highlights.userId, user.id));
    await db.delete(bookmarks).where(eq(bookmarks.userId, user.id));
    await audit(req, "notes.deleted_all", { metadata: { count: rows.length } });
    return { ok: true, deleted: rows.length };
  });

  app.get("/api/notes/export", async (req, reply) => {
    const user = currentUser(req);
    const rows = await db
      .select({ note: notes, contentTitle: contents.title })
      .from(notes)
      .innerJoin(contents, eq(contents.id, notes.contentId))
      .where(eq(notes.userId, user.id))
      .orderBy(asc(contents.title), asc(notes.pageNumber));
    const lines = [`# Minhas anotações — ${user.name}`, ""];
    let current = "";
    for (const r of rows) {
      if (r.contentTitle !== current) {
        current = r.contentTitle;
        lines.push(`## ${current}`, "");
      }
      lines.push(`- ${r.note.kind === "doubt" ? "[Dúvida] " : ""}${r.note.pageNumber ? `(p. ${r.note.pageNumber}) ` : ""}${r.note.body.replace(/\n/g, " ")}`);
      if (r.note.quote) lines.push(`  > ${r.note.quote.replace(/\n/g, " ")}`);
    }
    reply.header("Content-Type", "text/markdown; charset=utf-8").header("Content-Disposition", 'attachment; filename="minhas-anotacoes.md"');
    return lines.join("\n");
  });

  // ---------------------------------------------------------------- Marcadores
  app.get("/api/bookmarks", async (req) => {
    const user = currentUser(req);
    const q = parse(z.object({ contentId: z.string().uuid().optional() }), req.query);
    const conds = [eq(bookmarks.userId, user.id)];
    if (q.contentId) conds.push(eq(bookmarks.contentId, q.contentId));
    return db
      .select({ id: bookmarks.id, contentId: bookmarks.contentId, page: bookmarks.pageNumber, label: bookmarks.label, contentTitle: contents.title, createdAt: bookmarks.createdAt })
      .from(bookmarks)
      .innerJoin(contents, eq(contents.id, bookmarks.contentId))
      .where(and(...conds))
      .orderBy(asc(contents.title), asc(bookmarks.pageNumber));
  });

  app.post("/api/bookmarks", async (req) => {
    const body = parse(
      z.object({ contentId: z.string().uuid(), page: z.number().int().min(1).max(5000), label: z.string().trim().max(200).default("") }),
      req.body,
    );
    const c = await contentForUser(req, body.contentId, { requireUnlocked: false });
    const [row] = await db
      .insert(bookmarks)
      .values({ userId: c.lc.user.id, contentId: body.contentId, pageNumber: body.page, label: body.label })
      .onConflictDoUpdate({ target: [bookmarks.userId, bookmarks.contentId, bookmarks.pageNumber], set: { label: body.label } })
      .returning();
    return { id: row!.id, page: row!.pageNumber, label: row!.label };
  });

  app.delete("/api/bookmarks/:id", async (req) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const rows = await db.delete(bookmarks).where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id))).returning({ id: bookmarks.id });
    if (!rows.length) throw notFound("Marcador não encontrado.");
    return { ok: true };
  });

  // ---------------------------------------------------------------- Destaques
  app.get("/api/highlights", async (req) => {
    const user = currentUser(req);
    const q = parse(z.object({ contentId: z.string().uuid() }), req.query);
    return db
      .select()
      .from(highlights)
      .where(and(eq(highlights.userId, user.id), eq(highlights.contentId, q.contentId)))
      .orderBy(asc(highlights.pageNumber), asc(highlights.createdAt));
  });

  app.post("/api/highlights", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const body = parse(
      z.object({
        contentId: z.string().uuid(),
        page: z.number().int().min(1).max(5000),
        quote: z.string().trim().min(1).max(2000),
        color: z.enum(["yellow", "green", "blue", "pink"]).default("yellow"),
      }),
      req.body,
    );
    const c = await contentForUser(req, body.contentId, { requireUnlocked: false });
    const [row] = await db
      .insert(highlights)
      .values({ userId: c.lc.user.id, contentId: body.contentId, versionId: c.content.currentVersionId, pageNumber: body.page, quote: body.quote, color: body.color })
      .returning();
    return row;
  });

  app.delete("/api/highlights/:id", async (req) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const rows = await db.delete(highlights).where(and(eq(highlights.id, id), eq(highlights.userId, user.id))).returning({ id: highlights.id });
    if (!rows.length) throw notFound("Destaque não encontrado.");
    return { ok: true };
  });

  // ---------------------------------------------------------------- Dúvidas e comentários compartilhados
  async function commentsContext(req: Parameters<typeof contentForUser>[0], contentId: string) {
    const c = await contentForUser(req, contentId, { requireUnlocked: false });
    const community = await settings.get("community");
    const enabled = c.content.commentsEnabled ?? (c.track.structure.track.commentsEnabled && community.commentsEnabledDefault);
    if (!enabled) throw forbidden("Comentários não estão habilitados para este conteúdo.");
    const scope = await loadScope(db, c.lc.user);
    const canModerate = canManageArea(scope, c.area.id, "view");
    return { c, canModerate };
  }

  app.get("/api/contents/:id/comments", async (req) => {
    const { id } = parse(idParams, req.params);
    const { c, canModerate } = await commentsContext(req, id);
    const rows = await db
      .select({ comment: comments, authorName: users.name, authorRole: users.role })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(canModerate ? eq(comments.contentId, id) : and(eq(comments.contentId, id), eq(comments.isHidden, false)))
      .orderBy(asc(comments.createdAt));
    const map = (r: (typeof rows)[number]) => ({
      id: r.comment.id,
      parentId: r.comment.parentId,
      page: r.comment.pageNumber,
      body: r.comment.isHidden && !canModerate ? "" : r.comment.body,
      isHidden: r.comment.isHidden,
      author: { name: r.authorName, role: r.authorRole },
      isMine: r.comment.userId === c.lc.user.id,
      createdAt: r.comment.createdAt,
    });
    const top = rows.filter((r) => !r.comment.parentId).map(map);
    const replies = rows.filter((r) => r.comment.parentId).map(map);
    return {
      canModerate,
      threads: top.reverse().map((t) => ({ ...t, replies: replies.filter((r) => r.parentId === t.id) })),
    };
  });

  app.post("/api/contents/:id/comments", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        body: z.string().trim().min(1, "Escreva sua dúvida ou comentário.").max(5000),
        parentId: z.string().uuid().nullable().optional(),
        page: z.number().int().min(1).max(5000).nullable().optional(),
      }),
      req.body,
    );
    const { c } = await commentsContext(req, id);
    let parent: typeof comments.$inferSelect | undefined;
    if (body.parentId) {
      [parent] = await db.select().from(comments).where(and(eq(comments.id, body.parentId), eq(comments.contentId, id), isNull(comments.parentId)));
      if (!parent) throw notFound("Comentário original não encontrado.");
    }
    const [row] = await db
      .insert(comments)
      .values({ contentId: id, userId: c.lc.user.id, parentId: parent?.id ?? null, pageNumber: body.page ?? null, body: body.body })
      .returning();
    if (parent && parent.userId !== c.lc.user.id) {
      await notify(app.ctx, {
        userId: parent.userId,
        type: "comment_reply",
        title: "Nova resposta à sua dúvida",
        body: `${c.lc.user.name} respondeu em “${c.content.title}”.`,
        link: `/conteudos/${id}?painel=comentarios`,
        dedupeKey: `reply:${row!.id}`,
      });
    }
    return { id: row!.id };
  });

  app.delete("/api/comments/:id", async (req) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const [row] = await db.select().from(comments).where(eq(comments.id, id));
    if (!row) throw notFound();
    if (row.userId === user.id) {
      await db.delete(comments).where(eq(comments.id, id));
      return { ok: true };
    }
    const { canModerate } = await commentsContext(req, row.contentId);
    if (!canModerate) throw notFound();
    await db.update(comments).set({ isHidden: true, hiddenBy: user.id }).where(eq(comments.id, id));
    await audit(req, "comment.hidden", { targetType: "comment", targetId: id });
    return { ok: true };
  });

  /** Dúvidas abertas nas áreas do líder (para responder). */
  app.get("/api/leader/questions", async (req) => {
    const user = currentUser(req);
    const scope = await loadScope(db, user);
    if (scope.role === "collaborator") throw forbidden();
    const areaIds = scope.role === "admin" ? null : [...scope.leaderAreaIds];
    if (areaIds && !areaIds.length) return [];
    const rows = await db
      .select({ comment: comments, authorName: users.name, contentTitle: contents.title, trackTitle: tracks.title })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .innerJoin(contents, eq(contents.id, comments.contentId))
      .innerJoin(modules, eq(modules.id, contents.moduleId))
      .innerJoin(tracks, eq(tracks.id, modules.trackId))
      .where(
        and(
          isNull(comments.parentId),
          eq(comments.isHidden, false),
          areaIds ? inArray(tracks.areaId, areaIds) : undefined,
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(100);
    const ids = rows.map((r) => r.comment.id);
    const replies = ids.length ? await db.select({ parentId: comments.parentId }).from(comments).where(inArray(comments.parentId, ids)) : [];
    return rows.map((r) => ({
      id: r.comment.id,
      contentId: r.comment.contentId,
      contentTitle: r.contentTitle,
      trackTitle: r.trackTitle,
      author: r.authorName,
      body: r.comment.body,
      page: r.comment.pageNumber,
      createdAt: r.comment.createdAt,
      replies: replies.filter((x) => x.parentId === r.comment.id).length,
    }));
  });
}
