import { and, asc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { userCode } from "../../shared/domain.js";
import { estimateReadingMinutes } from "../../shared/reading.js";
import { assessments, bookmarks, contentProgress, contents, contentVersions, documentPages, files, readingSessions, users } from "../db/schema.js";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.js";
import { audit, currentUser } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { contentForUser } from "../services/access.js";
import { applyWatermark } from "../services/documents/watermark.js";
import { refreshEnrollment } from "../services/progress.js";

const idParams = z.object({ id: z.string().uuid() });
const pageParams = z.object({ id: z.string().uuid(), n: z.coerce.number().int().min(1).max(5000) });

/** Cache curto da decisão de acesso por sessão+conteúdo (evita recalcular a cada página). */
interface ReaderGrant {
  versionId: string;
  allowTextMode: boolean;
  until: number;
  epoch: number;
}
const grants = new Map<string, ReaderGrant>();
const GRANT_TTL_MS = 15_000;
// Qualquer alteração administrativa (regras, atribuições, publicação) invalida o cache do leitor.
let accessEpoch = 0;

function formatDate(d: Date) {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export async function readerRoutes(app: FastifyInstance) {
  const { db, storage, settings } = app.ctx;

  app.addHook("onResponse", async (req, reply) => {
    if (req.method !== "GET" && reply.statusCode < 400 && /^\/api\/(admin|leader)\//.test(req.url)) accessEpoch++;
  });

  async function grantFor(req: FastifyRequest, contentId: string): Promise<ReaderGrant> {
    const key = `${req.auth!.session.id}:${contentId}`;
    const cached = grants.get(key);
    if (cached && cached.until > Date.now() && cached.epoch === accessEpoch) return cached;
    const c = await contentForUser(req, contentId);
    if (c.content.type !== "document" || !c.content.currentVersionId) throw notFound("Documento indisponível.");
    const reading = await settings.get("reading");
    const grant = {
      versionId: c.content.currentVersionId,
      allowTextMode: c.content.allowTextMode ?? reading.allowTextModeDefault,
      until: Date.now() + GRANT_TTL_MS,
      epoch: accessEpoch,
    };
    if (grants.size > 5000) grants.clear();
    grants.set(key, grant);
    return grant;
  }

  const pageRateLimit = {
    max: async () => (await settings.get("security")).pageRequestsPerMinute,
    timeWindow: "1 minute",
    keyGenerator: (req: FastifyRequest) => req.auth?.user.id ?? req.ip,
    onExceeded: (req: FastifyRequest) => {
      void audit(req, "reader.rate_limited", { outcome: "denied", metadata: { url: req.url } });
    },
  };

  app.get("/api/contents/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const c = await contentForUser(req, id);
    const reading = await settings.get("reading");
    const community = await settings.get("community");
    const user = c.lc.user;

    const [version] = c.content.currentVersionId
      ? await db.select().from(contentVersions).where(eq(contentVersions.id, c.content.currentVersionId))
      : [];
    const pages = version
      ? await db
          .select({ n: documentPages.pageNumber, w: documentPages.width, h: documentPages.height, words: documentPages.wordCount })
          .from(documentPages)
          .where(eq(documentPages.versionId, version.id))
          .orderBy(asc(documentPages.pageNumber))
      : [];
    const [progress] = await db.select().from(contentProgress).where(and(eq(contentProgress.userId, user.id), eq(contentProgress.contentId, id)));
    const marks = await db
      .select()
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, user.id), eq(bookmarks.contentId, id)))
      .orderBy(asc(bookmarks.pageNumber));
    const moduleAssessments = await db
      .select({ id: assessments.id, title: assessments.title, status: assessments.status })
      .from(assessments)
      .where(eq(assessments.moduleId, c.module.id));
    const wpm = c.area.settings.wordsPerMinute ?? reading.wordsPerMinute;
    const estimate = estimateReadingMinutes({
      wordCount: version?.wordCount ?? 0,
      pageCount: version?.pageCount ?? 0,
      wordsPerMinute: wpm,
      minutesPerPageFallback: reading.minutesPerPageFallback,
      factor: c.content.readingFactor,
      overrideMinutes: c.content.estimatedMinutesOverride,
    });
    const siblings = c.moduleView.contents;
    const idx = siblings.findIndex((x) => x.id === id);
    const nextContent = idx >= 0 ? siblings.slice(idx + 1).find((x) => !x.locked) : undefined;
    const commentsEnabled = c.content.commentsEnabled ?? (c.track.structure.track.commentsEnabled && community.commentsEnabledDefault);

    return {
      preview: c.track.preview,
      content: {
        id: c.content.id,
        title: c.content.title,
        type: c.content.type,
        description: c.content.description,
        learningObjective: c.content.learningObjective,
        ownerName: c.content.ownerName,
        isRequired: c.content.isRequired,
        externalUrl: c.content.type === "document" ? null : c.content.externalUrl,
        bodyText: c.content.type === "text" ? c.content.bodyText : null,
        allowTextMode: c.content.allowTextMode ?? reading.allowTextModeDefault,
        allowDownload: c.content.allowDownload && c.content.type === "document",
        commentsEnabled,
      },
      version: version
        ? {
            id: version.id,
            number: version.versionNumber,
            pageCount: version.pageCount,
            wordCount: version.wordCount,
            outline: version.outline,
            processingStatus: version.processingStatus,
            publishedAt: version.publishedAt,
            changeNotes: version.changeNotes,
          }
        : null,
      pages,
      estimate: { minutes: estimate, wordsPerMinute: wpm, factor: c.content.readingFactor },
      progress: progress
        ? {
            status: progress.status,
            percent: progress.percent,
            lastPage: progress.lastPage,
            pagesRead: progress.pagesRead,
            activeSeconds: progress.activeSeconds,
            viewSeconds: progress.viewSeconds,
            versionId: progress.versionId,
          }
        : null,
      bookmarks: marks.map((b) => ({ id: b.id, page: b.pageNumber, label: b.label })),
      track: { id: c.track.structure.track.id, title: c.track.structure.track.title },
      module: { id: c.module.id, title: c.module.title },
      next: nextContent ? { id: nextContent.id, title: nextContent.title } : null,
      assessments: moduleAssessments.filter((a) => a.status === "published" || c.track.preview).map((a) => ({ id: a.id, title: a.title })),
      watermark: { name: user.name, code: userCode(user.seq) },
      readingRules: { minPageSeconds: reading.minPageSeconds, idleSeconds: reading.idleSeconds, completionThreshold: reading.completionThreshold },
    };
  });

  app.post("/api/contents/:id/sessions", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const c = await contentForUser(req, id);
    const [s] = await db
      .insert(readingSessions)
      .values({ userId: c.lc.user.id, contentId: id, versionId: c.content.currentVersionId })
      .returning();
    await audit(req, "content.opened", { targetType: "content", targetId: id, metadata: { session: s!.id, version: c.content.currentVersionId } });
    return { sessionId: s!.id, startedAt: s!.startedAt, watermarkDate: formatDate(s!.startedAt) };
  });

  app.post("/api/reading-sessions/:id/heartbeat", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const user = currentUser(req);
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        page: z.number().int().min(1).max(5000),
        activeSeconds: z.number().min(0).max(600),
        viewSeconds: z.number().min(0).max(600),
        pagesRead: z.array(z.number().int().min(1).max(5000)).max(50).default([]),
        ended: z.boolean().optional(),
      }),
      req.body,
    );
    const [session] = await db.select().from(readingSessions).where(and(eq(readingSessions.id, id), eq(readingSessions.userId, user.id)));
    if (!session) throw notFound("Sessão de leitura não encontrada.");
    if (session.endedAt) throw badRequest("Sessão de leitura encerrada.");
    // Revalida o acesso: colaborador desativado ou com acesso revogado deixa de registrar progresso.
    const c = await contentForUser(req, session.contentId);
    const reading = await settings.get("reading");

    const now = Date.now();
    const elapsed = Math.max(0, (now - session.lastHeartbeatAt.getTime()) / 1000);
    const cap = Math.min(elapsed + 5, 120);
    const active = Math.round(Math.min(body.activeSeconds, cap));
    const view = Math.round(Math.min(body.viewSeconds, cap));

    const [version] = c.content.currentVersionId ? await db.select().from(contentVersions).where(eq(contentVersions.id, c.content.currentVersionId)) : [];
    const pageCount = version?.pageCount ?? 0;
    const [existing] = await db.select().from(contentProgress).where(and(eq(contentProgress.userId, user.id), eq(contentProgress.contentId, session.contentId)));
    const sameVersion = !existing || existing.versionId === (version?.id ?? null);
    const prevRead = new Set(sameVersion ? existing?.pagesRead ?? [] : []);
    // Limite de páginas novas por pulso: não dá para "ler" o documento inteiro sem tempo ativo.
    const maxNew = Math.ceil(active / Math.max(1, reading.minPageSeconds)) + 1;
    let added = 0;
    for (const p of body.pagesRead) {
      if (p > pageCount || prevRead.has(p)) continue;
      if (added >= maxNew) break;
      prevRead.add(p);
      added++;
    }
    const pagesRead = [...prevRead].sort((a, b) => a - b);
    const percent = pageCount ? Math.min(100, Math.round((pagesRead.length / pageCount) * 100)) : 0;
    // Conclusão é preservada entre versões (histórico de aprendizado); as páginas lidas valem por versão.
    const wasCompleted = existing?.status === "completed";
    const completed = wasCompleted || percent >= reading.completionThreshold;
    const status = completed ? "completed" : "in_progress";
    const page = Math.min(Math.max(1, body.page), Math.max(1, pageCount));

    await db
      .insert(contentProgress)
      .values({
        userId: user.id,
        contentId: session.contentId,
        versionId: version?.id ?? null,
        status,
        lastPage: page,
        pagesRead,
        percent,
        activeSeconds: active,
        viewSeconds: view,
        startedAt: new Date(),
        completedAt: completed ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [contentProgress.userId, contentProgress.contentId],
        set: {
          versionId: version?.id ?? null,
          status,
          lastPage: page,
          pagesRead,
          percent,
          activeSeconds: (existing?.activeSeconds ?? 0) + active,
          viewSeconds: (existing?.viewSeconds ?? 0) + view,
          completedAt: completed ? existing?.completedAt ?? new Date() : null,
          updatedAt: new Date(),
        },
      });
    await db
      .update(readingSessions)
      .set({
        lastHeartbeatAt: new Date(now),
        activeSeconds: session.activeSeconds + active,
        viewSeconds: session.viewSeconds + view,
        pagesViewed: Math.max(session.pagesViewed, pagesRead.length),
        endedAt: body.ended ? new Date(now) : null,
      })
      .where(eq(readingSessions.id, id));
    await db.update(users).set({ lastActivityAt: new Date() }).where(eq(users.id, user.id));

    const statusChanged = !existing || existing.status !== status || !sameVersion;
    if (statusChanged || added > 0) await refreshEnrollment(app.ctx, user.id, c.track.structure.track.id);
    if (status === "completed" && !wasCompleted) {
      await audit(req, "content.completed", { targetType: "content", targetId: session.contentId });
    }
    return { status, percent, pagesRead, lastPage: page };
  });

  app.get("/api/contents/:id/pages/:n/image", { config: { rateLimit: pageRateLimit } }, async (req, reply) => {
    const user = currentUser(req);
    const { id, n } = parse(pageParams, req.params);
    const { s } = parse(z.object({ s: z.string().uuid().optional() }), req.query);
    const grant = await grantFor(req, id);
    const [page] = await db
      .select()
      .from(documentPages)
      .where(and(eq(documentPages.versionId, grant.versionId), eq(documentPages.pageNumber, n)));
    if (!page) throw notFound("Página não encontrada.");

    let sessionStart = new Date();
    let sessionCode = req.auth!.session.id.slice(0, 8);
    if (s) {
      const [rs] = await db
        .select()
        .from(readingSessions)
        .where(and(eq(readingSessions.id, s), eq(readingSessions.userId, user.id), isNull(readingSessions.endedAt)));
      if (rs) {
        sessionStart = rs.startedAt;
        sessionCode = rs.id.slice(0, 8);
      }
    }
    const raw = await storage.get(page.imageKey);
    const image = await applyWatermark(raw, { name: user.name, code: userCode(user.seq), date: formatDate(sessionStart), session: sessionCode });
    reply
      .header("Content-Type", "image/webp")
      .header("Cache-Control", "no-store, private, max-age=0")
      .header("Content-Disposition", "inline")
      .header("X-Content-Type-Options", "nosniff");
    return reply.send(image);
  });

  app.get("/api/contents/:id/pages/:n/text", { config: { rateLimit: pageRateLimit } }, async (req) => {
    const { id, n } = parse(pageParams, req.params);
    const grant = await grantFor(req, id);
    if (!grant.allowTextMode) throw forbidden("O modo texto não está habilitado para este conteúdo.");
    const [page] = await db
      .select({ text: documentPages.text, words: documentPages.wordCount })
      .from(documentPages)
      .where(and(eq(documentPages.versionId, grant.versionId), eq(documentPages.pageNumber, n)));
    if (!page) throw notFound("Página não encontrada.");
    return { page: n, text: page.text, words: page.words };
  });

  app.get("/api/contents/:id/download", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id } = parse(idParams, req.params);
    const c = await contentForUser(req, id);
    if (!c.content.allowDownload || c.content.type !== "document" || !c.content.currentVersionId) {
      await audit(req, "content.download", { outcome: "denied", targetType: "content", targetId: id });
      throw forbidden("Este material não permite download.");
    }
    const [version] = await db.select().from(contentVersions).where(eq(contentVersions.id, c.content.currentVersionId));
    const [file] = version?.fileId ? await db.select().from(files).where(eq(files.id, version.fileId)) : [];
    if (!file) throw notFound();
    const data = await storage.get(file.storageKey);
    await audit(req, "content.download", { targetType: "content", targetId: id });
    const safeName = c.content.title.replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 80) || "documento";
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="documento.pdf"; filename*=UTF-8''${encodeURIComponent(safeName)}.pdf`);
    return reply.send(data);
  });

  /** Conclusão manual para conteúdos que não são apostilas (link, vídeo, texto). */
  app.post("/api/contents/:id/complete", async (req) => {
    const { id } = parse(idParams, req.params);
    const c = await contentForUser(req, id);
    if (c.content.type === "document") throw badRequest("Apostilas são concluídas pela leitura das páginas.");
    const now = new Date();
    await db
      .insert(contentProgress)
      .values({ userId: c.lc.user.id, contentId: id, status: "completed", percent: 100, startedAt: now, completedAt: now })
      .onConflictDoUpdate({
        target: [contentProgress.userId, contentProgress.contentId],
        set: { status: "completed", percent: 100, completedAt: now, updatedAt: now },
      });
    await refreshEnrollment(app.ctx, c.lc.user.id, c.track.structure.track.id);
    await audit(req, "content.completed", { targetType: "content", targetId: id });
    return { ok: true };
  });

  /** Eventos do leitor relevantes para segurança (tentativa de impressão, cópia, salvar). */
  app.post("/api/contents/:id/events", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const { type } = parse(z.object({ type: z.enum(["print_attempt", "copy_attempt", "save_attempt", "context_menu"]) }), req.body);
    const [c] = await db.select({ id: contents.id }).from(contents).where(eq(contents.id, id));
    if (!c) throw notFound();
    await audit(req, `reader.${type}`, { outcome: "denied", targetType: "content", targetId: id });
    return { ok: true };
  });

  // Acesso direto a caminhos de armazenamento nunca existe; esta rota responde 404 explicitamente.
  app.get("/api/storage/*", { config: { public: true } }, async () => {
    throw new HttpError(404, "not_found", "Não encontrado.");
  });
}
