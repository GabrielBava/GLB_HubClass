import { count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { files, users } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

/** Rotas públicas: identidade visual (para a tela de login) e verificação de saúde. */
export async function publicRoutes(app: FastifyInstance) {
  const { db, settings, storage, config } = app.ctx;

  app.get("/api/public/branding", { config: { public: true, allowPartial: true } }, async (_req, reply) => {
    const b = await settings.get("branding");
    reply.header("Cache-Control", "no-cache");
    return {
      platformName: b.platformName,
      organizationName: b.organizationName,
      tagline: b.tagline,
      loginMessage: b.loginMessage,
      colors: b.colors,
      fonts: b.fonts,
      defaultMode: b.defaultMode,
      logoUrl: b.logoFileId ? `/api/public/logo?v=${b.logoFileId.slice(0, 8)}` : null,
      logoDarkUrl: b.logoDarkFileId ? `/api/public/logo?variant=dark&v=${b.logoDarkFileId.slice(0, 8)}` : null,
    };
  });

  app.get("/api/public/logo", { config: { public: true, allowPartial: true } }, async (req, reply) => {
    const b = await settings.get("branding");
    const fileId = (req.query as { variant?: string }).variant === "dark" ? b.logoDarkFileId : b.logoFileId;
    if (!fileId) throw notFound();
    const [file] = await db.select().from(files).where(eq(files.id, fileId));
    if (!file || file.purpose !== "logo") throw notFound();
    const data = await storage.get(file.storageKey);
    reply.header("Content-Type", file.mimeType).header("Cache-Control", "public, max-age=300").header("X-Content-Type-Options", "nosniff");
    return reply.send(data);
  });

  /**
   * Saúde e diagnóstico da implantação: diz o que falta configurar, sem expor segredos.
   * Responde 503 só quando o banco não responde (para monitores de disponibilidade).
   */
  app.get("/api/health", { config: { public: true, allowPartial: true } }, async (req, reply) => {
    const problems: string[] = [];
    const warnings: string[] = [];
    let database: "ok" | "sem tabelas" | "sem conexão" = "ok";
    let administrator: boolean | null = null;
    try {
      const [row] = await db.select({ n: count() }).from(users).where(eq(users.role, "admin"));
      administrator = Number(row?.n ?? 0) > 0;
    } catch (err) {
      const message = (err as Error & { cause?: Error }).cause?.message ?? (err as Error).message;
      database = /does not exist|não existe/i.test(message) ? "sem tabelas" : "sem conexão";
      req.log.error({ err }, "diagnóstico: falha ao consultar o banco");
    }
    if (database === "sem tabelas") problems.push("O banco está conectado, mas as tabelas não existem: faça Redeploy (o build cria as tabelas).");
    if (database === "sem conexão") problems.push("Sem conexão com o banco: confira o Neon em Storage (ligado a este ambiente) e faça Redeploy.");
    if (administrator === false) {
      problems.push("Nenhum administrador: cadastre BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD e faça Redeploy, ou use /configuracao-inicial com o SETUP_TOKEN.");
    }
    if (storage.kind === "vercel-blob" && !process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
      problems.push("Armazenamento de arquivos não conectado: crie a loja Blob como Private em Storage, ligue à Production e faça Redeploy.");
    }
    if (config.serverless && !config.cronSecret) warnings.push("CRON_SECRET não definido (mínimo de 16 caracteres): a rotina diária não roda.");
    if (process.env.BOOTSTRAP_ADMIN_PASSWORD && administrator) warnings.push("O administrador já existe: apague as variáveis BOOTSTRAP_ADMIN_* na Vercel.");
    reply.header("Cache-Control", "no-store");
    if (database !== "ok") reply.status(503);
    return {
      ok: problems.length === 0,
      time: new Date().toISOString(),
      checks: { database, administrator, storage: storage.kind, environment: config.serverless ? "vercel" : config.env },
      problems,
      warnings,
    };
  });
}
