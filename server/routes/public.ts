import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { files } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

/** Rotas públicas: identidade visual (para a tela de login) e verificação de saúde. */
export async function publicRoutes(app: FastifyInstance) {
  const { db, settings, storage } = app.ctx;

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

  app.get("/api/health", { config: { public: true, allowPartial: true } }, async () => {
    return { ok: true, time: new Date().toISOString() };
  });
}
