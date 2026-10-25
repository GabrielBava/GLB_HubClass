import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "./config.js";
import { openDatabase, type Database, type DB } from "./db/client.js";
import { resolveSession, sessionCookieName, type AuthState } from "./auth/sessions.js";
import { HttpError } from "./lib/errors.js";
import { Secrets, safeEqual } from "./lib/crypto.js";
import { SettingsService } from "./services/settings.js";
import { createStorage, type StorageDriver } from "./services/storage/index.js";
import { createMailer, type Mailer } from "./services/mailer.js";
import { JobQueue } from "./services/jobs.js";
import { registerRoutes } from "./routes/index.js";
import { recoverPendingDocuments } from "./services/documents/pipeline.js";

export interface AppContext {
  config: AppConfig;
  database: Database;
  db: DB;
  secrets: Secrets;
  settings: SettingsService;
  storage: StorageDriver;
  mailer: Mailer;
  jobs: JobQueue;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth: AuthState | null;
  }
  interface FastifyContextConfig {
    /** Rota acessível sem sessão (login, convite, recuperação). */
    public?: boolean;
    /** Rota acessível com sessão parcial, antes de concluir o MFA. */
    allowPartial?: boolean;
  }
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originAllowed(req: FastifyRequest, allowed: string[]): boolean {
  const origin = req.headers.origin;
  if (origin) return allowed.includes(origin);
  const referer = req.headers.referer;
  if (referer) {
    try {
      return allowed.includes(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  // Requisições que alteram dados precisam declarar a origem.
  return false;
}

export async function buildApp(config: AppConfig, opts: { database?: Database } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.env === "test" ? false : { level: config.logLevel, redact: ["req.headers.cookie", "req.headers['x-csrf-token']"] },
    trustProxy: config.trustProxy,
    bodyLimit: 1_048_576,
  });

  const database = opts.database ?? (await openDatabase({ databaseUrl: config.databaseUrl, embeddedDir: config.embeddedDbDir }));
  if (!opts.database) await database.migrate();

  const ctx: AppContext = {
    config,
    database,
    db: database.db,
    secrets: new Secrets(config.appSecret),
    settings: new SettingsService(database.db),
    storage: createStorage(config),
    mailer: createMailer(config, app.log),
    jobs: new JobQueue(app.log),
  };
  app.decorate("ctx", ctx);
  app.decorateRequest("auth", null);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "same-origin" },
    hsts: config.env === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: 200 * 1024 * 1024, files: 1, fields: 30, fieldSize: 100_000 },
  });

  app.addHook("onRequest", async (req, reply) => {
    // Conteúdo privado: nunca indexar nem guardar em caches compartilhados.
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store, private");
  });

  // Resolve a sessão a partir do cookie HttpOnly.
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[sessionCookieName(config.cookieSecure)];
    if (!token) return;
    const security = await ctx.settings.get("security");
    req.auth = await resolveSession(ctx.db, token, security);
  });

  // Negar por padrão: toda rota /api exige sessão, salvo as marcadas como públicas.
  // Também valida origem e token CSRF em qualquer requisição que altera dados.
  app.addHook("onRequest", async (req) => {
    if (!req.url.startsWith("/api/")) return;
    const routeConfig = req.routeOptions.config ?? {};
    if (UNSAFE_METHODS.has(req.method)) {
      if (!originAllowed(req, config.allowedOrigins)) {
        throw new HttpError(403, "bad_origin", "Origem da requisição não autorizada.");
      }
      if (req.auth) {
        const header = req.headers["x-csrf-token"];
        if (typeof header !== "string" || !safeEqual(header, req.auth.session.csrfToken)) {
          throw new HttpError(403, "csrf", "Sua sessão foi atualizada. Recarregue a página e tente novamente.");
        }
      }
    }
    if (routeConfig.public) return;
    if (!req.auth) throw new HttpError(401, "unauthorized", "Sessão expirada. Entre novamente.");
    if (!req.auth.mfaSatisfied && !routeConfig.allowPartial) {
      throw new HttpError(403, "mfa_required", "Conclua a verificação em duas etapas para continuar.");
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string; validation?: unknown };
    if (e.code === "FST_REQ_FILE_TOO_LARGE" || e.code === "FST_FILES_LIMIT") {
      return reply.status(413).send({ error: { code: "file_too_large", message: "Arquivo maior que o limite permitido." } });
    }
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: "too_many_requests", message: "Muitas requisições. Aguarde um pouco e tente novamente." } });
    }
    if (e.validation || (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)) {
      return reply.status(e.statusCode ?? 400).send({ error: { code: "bad_request", message: "Requisição inválida." } });
    }
    req.log.error({ err }, "erro inesperado");
    return reply.status(500).send({ error: { code: "internal", message: "Erro inesperado. Tente novamente em instantes." } });
  });

  await registerRoutes(app);

  // Front-end compilado (produção). A pasta de armazenamento nunca é servida.
  const webDir = path.resolve(process.cwd(), "dist/web");
  const hasWeb = config.env !== "test" && existsSync(path.join(webDir, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDir,
      wildcard: false,
      index: false,
      // Nesta versão do plugin, o primeiro argumento é a resposta do Fastify (não a do Node).
      setHeaders(reply, filePath) {
        reply.header("Cache-Control", filePath.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache");
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || !hasWeb || req.method !== "GET") {
      return reply.status(404).send({ error: { code: "not_found", message: "Não encontrado." } });
    }
    // Rotas da aplicação de página única.
    reply.header("Cache-Control", "no-cache");
    return reply.sendFile("index.html");
  });

  app.addHook("onClose", async () => {
    await ctx.jobs.drain();
    if (!opts.database) await database.close();
  });

  if (config.env !== "test") {
    app.addHook("onReady", async () => {
      await recoverPendingDocuments(app);
    });
  }

  return app;
}
