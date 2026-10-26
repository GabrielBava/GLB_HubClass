import { count, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { issueAuthToken } from "../auth/tokens.js";
import { contentVersions, users } from "../db/schema.js";
import { safeEqual } from "../lib/crypto.js";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors.js";
import { audit, requireRole } from "../lib/http.js";
import { directUploadPrefix } from "../lib/upload.js";
import { parse } from "../lib/validate.js";
import { inviteEmail } from "../services/emails.js";
import { processVersion } from "../services/documents/pipeline.js";
import { applyRetention } from "../services/maintenance.js";
import { applyDueOffboardings } from "../services/offboarding.js";
import type { VercelBlobStorage } from "../services/storage/vercel-blob.js";

/** Tamanho máximo autorizado para um envio direto (o limite de cada tipo é conferido na confirmação). */
const DIRECT_UPLOAD_MAX = 210 * 1024 * 1024;
/** Prazo para o navegador concluir o envio direto. */
const DIRECT_UPLOAD_SECONDS = 15 * 60;
/** Tempo de trabalho da rotina diária antes de deixar o restante para a próxima execução (limite da função: 300 s). */
const CRON_BUDGET_MS = 200_000;

/**
 * Rotas da plataforma na Vercel:
 * - envio direto de arquivos grandes ao armazenamento privado (Vercel Blob);
 * - rotina diária agendada (retenção, desligamentos, documentos pendentes, envios abandonados);
 * - configuração inicial: cria o primeiro administrador quando o banco está vazio.
 */
export async function platformRoutes(app: FastifyInstance) {
  const { db, storage, settings, mailer, config } = app.ctx;

  // ------------------------------------------------------------------ Envio direto (Vercel Blob)
  app.post("/api/uploads/blob", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const admin = requireRole(req, "admin");
    if (storage.kind !== "vercel-blob") throw notFound();
    const blob = storage as VercelBlobStorage;
    const prefix = directUploadPrefix(admin.id);
    const { handleUploadPresigned } = await import("@vercel/blob/client");
    return handleUploadPresigned({
      body: req.body as never,
      request: req.raw,
      getSignedToken: async (pathname) => {
        // Cada pessoa só envia para a própria pasta temporária, com nome gerado pelo navegador (UUID).
        if (!pathname.startsWith(prefix) || !/^[0-9a-f-]{36}$/.test(pathname.slice(prefix.length))) throw badRequest("Destino de envio inválido.");
        const { token, validUntil } = await blob.signedUploadToken(pathname, DIRECT_UPLOAD_MAX, DIRECT_UPLOAD_SECONDS);
        return { token, urlOptions: { validUntil, maximumSizeInBytes: DIRECT_UPLOAD_MAX, allowOverwrite: false } };
      },
    });
  });

  // ------------------------------------------------------------------ Rotina diária
  app.get("/api/cron/maintenance", { config: { public: true, allowPartial: true } }, async (req) => {
    // A Vercel envia "Authorization: Bearer <CRON_SECRET>"; sem o segredo configurado, a rota não existe.
    if (!config.cronSecret) throw notFound();
    const header = req.headers.authorization ?? "";
    if (!safeEqual(header, `Bearer ${config.cronSecret}`)) throw new HttpError(401, "unauthorized", "Não autorizado.");
    const started = Date.now();
    const offboarded = await applyDueOffboardings(db);
    const retention = await applyRetention(db, await settings.get("privacy"));
    let staleUploads = 0;
    if (storage.kind === "vercel-blob") {
      staleUploads = await (storage as VercelBlobStorage).deleteOlderThan("uploads/tmp/", new Date(Date.now() - 86_400_000));
    }
    // Documentos cujo processamento foi interrompido (ex.: tempo esgotado): retomados um a um.
    const pending = await db
      .select({ id: contentVersions.id })
      .from(contentVersions)
      .where(inArray(contentVersions.processingStatus, ["pending", "processing"]));
    let documents = 0;
    for (const v of pending) {
      if (Date.now() - started > CRON_BUDGET_MS) break;
      await processVersion(app.ctx, v.id).catch((err) => req.log.error({ err, version: v.id }, "falha ao reprocessar documento"));
      documents++;
    }
    const result = { offboarded, retention, staleUploads, documents, pendingDocuments: pending.length - documents };
    req.log.info({ result }, "rotina diária concluída");
    return { ok: true, ...result };
  });

  // ------------------------------------------------------------------ Configuração inicial
  async function hasAdmin() {
    const [row] = await db.select({ n: count() }).from(users).where(eq(users.role, "admin"));
    return Number(row?.n ?? 0) > 0;
  }

  app.get("/api/setup/status", { config: { public: true, allowPartial: true } }, async () => {
    return { available: !!config.setupToken && !(await hasAdmin()) };
  });

  const setupBody = z.object({
    token: z.string().min(1).max(500),
    name: z.string().trim().min(3).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
  });

  app.post("/api/setup", { config: { public: true, rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
    if (!config.setupToken) throw notFound();
    const body = parse(setupBody, req.body);
    if (!safeEqual(body.token, config.setupToken)) {
      await audit(req, "setup.first_admin", { outcome: "denied", metadata: { reason: "token" } });
      throw new HttpError(403, "forbidden", "Código de configuração incorreto.");
    }
    if (await hasAdmin()) throw conflict("A plataforma já tem administrador. Use o login normal.");
    const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${body.email}`);
    if (existing) throw conflict("Já existe um usuário com este e-mail.");
    const [user] = await db.insert(users).values({ email: body.email, name: body.name, role: "admin", status: "invited" }).returning();
    const security = await settings.get("security");
    const branding = await settings.get("branding");
    const token = await issueAuthToken(db, { userId: user!.id, type: "invite", ttlMinutes: security.inviteExpiryHours * 60 });
    const link = `${config.appOrigin}/convite/${token}`;
    await mailer.send({ to: body.email, ...inviteEmail({ name: body.name, link, platform: branding.platformName, organization: branding.organizationName, expiresHours: security.inviteExpiryHours }) });
    await audit(req, "user.admin_bootstrap", { targetType: "user", targetId: user!.id, metadata: { email: body.email, via: "setup" } });
    // Quem tem o código de configuração recebe o link na tela (é a mesma pessoa que fez o deploy).
    return { inviteLink: link, emailed: mailer.configured, expiresHours: security.inviteExpiryHours };
  });
}
