import { asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LEVELS, LIBRARY_LICENSES, LIBRARY_TYPES, NOTIFICATION_TYPES, PUBLICATION_STATUS } from "../../../shared/domain.js";
import { FONT_CHOICES, type AllSettings, type SettingsKey } from "../../../shared/settings.js";
import { libraryItems, termsAcceptances, termsVersions } from "../../db/schema.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit, requireRole } from "../../lib/http.js";
import { detectImage, readSingleFile } from "../../lib/upload.js";
import { parse } from "../../lib/validate.js";
import { storePrivateFile } from "../../services/documents/pipeline.js";
import { isPdf } from "../../services/documents/pdf.js";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use uma cor no formato #RRGGBB.");
const font = z.enum(FONT_CHOICES);

const schemas: { [K in SettingsKey]: z.ZodType<Partial<AllSettings[K]>> } = {
  branding: z.object({
    platformName: z.string().trim().min(2).max(60),
    organizationName: z.string().trim().min(2).max(120),
    tagline: z.string().trim().max(300),
    loginMessage: z.string().trim().max(300),
    colors: z.object({ primary: hex, brandSurface: hex, accent: hex }),
    fonts: z.object({ heading: font, body: font }),
    defaultMode: z.enum(["light", "dark", "system"]),
  }).partial() as never,
  catalog: z.object({ lockedVisibility: z.enum(["locked", "hidden"]), allowAccessRequests: z.boolean() }).partial(),
  reading: z
    .object({
      wordsPerMinute: z.number().int().min(80).max(600),
      minutesPerPageFallback: z.number().min(0.5).max(20),
      minPageSeconds: z.number().int().min(1).max(300),
      completionThreshold: z.number().int().min(50).max(100),
      idleSeconds: z.number().int().min(30).max(1800),
      allowTextModeDefault: z.boolean(),
    })
    .partial(),
  assessment: z.object({ defaultPassingScore: z.number().int().min(0).max(100), defaultMaxAttempts: z.number().int().min(1).max(50).nullable() }).partial(),
  security: z
    .object({
      sessionIdleMinutes: z.number().int().min(5).max(24 * 60),
      sessionAbsoluteHours: z.number().int().min(1).max(24 * 14),
      maxFailedLogins: z.number().int().min(3).max(20),
      lockoutMinutes: z.number().int().min(1).max(24 * 60),
      passwordMinLength: z.number().int().min(8).max(64),
      inviteExpiryHours: z.number().int().min(1).max(24 * 14),
      resetExpiryMinutes: z.number().int().min(10).max(24 * 60),
      pageRequestsPerMinute: z.number().int().min(20).max(600),
      maxUploadMb: z.number().int().min(1).max(200),
    })
    .partial(),
  notifications: z
    .object({ emailEnabled: z.boolean(), emailTypes: z.array(z.enum(NOTIFICATION_TYPES)).max(30), deadlineReminderDays: z.number().int().min(1).max(30) })
    .partial(),
  privacy: z
    .object({
      auditRetentionDays: z.number().int().min(180).max(3650),
      readingSessionRetentionDays: z.number().int().min(30).max(3650),
      notificationRetentionDays: z.number().int().min(30).max(3650),
      dataProtectionContact: z.string().trim().max(200),
    })
    .partial(),
  community: z.object({ commentsEnabledDefault: z.boolean() }).partial(),
  onboarding: z
    .object({ welcomeMessage: z.string().trim().min(10).max(3000), supportContact: z.string().trim().max(200), required: z.boolean(), approvalRequired: z.boolean() })
    .partial(),
};

export async function adminSettingsRoutes(app: FastifyInstance) {
  const { db, settings, config, mailer, database } = app.ctx;

  app.get("/api/admin/settings", async (req) => {
    requireRole(req, "admin");
    return {
      settings: await settings.all(),
      environment: {
        database: database.kind === "postgres" ? "PostgreSQL" : "PostgreSQL embutido (desenvolvimento)",
        storage: config.storage.driver === "s3" ? "Armazenamento S3 privado" : "Disco local privado",
        smtp: mailer.configured,
        antivirus: !!config.clamav,
        docxConversion: config.docx.enabled,
        cookieSecure: config.cookieSecure,
        environment: config.env,
      },
    };
  });

  app.put("/api/admin/settings/:group", async (req) => {
    const admin = requireRole(req, "admin");
    const { group } = parse(z.object({ group: z.enum(Object.keys(schemas) as [SettingsKey, ...SettingsKey[]]) }), req.params);
    const patch = parse(schemas[group], req.body);
    const current = await settings.get(group);
    const saved = await settings.set(group, { ...current, ...patch } as never, admin.id);
    await audit(req, "settings.updated", { targetType: "settings", targetId: group, metadata: { fields: Object.keys(patch as object) } });
    return saved;
  });

  // Logotipo para fundo claro (padrão) ou escuro (?variant=dark).
  const logoField = (req: { query: unknown }) => ((req.query as { variant?: string }).variant === "dark" ? "logoDarkFileId" : "logoFileId");

  app.post("/api/admin/settings/logo", async (req) => {
    const admin = requireRole(req, "admin");
    const file = await readSingleFile(req, 1024 * 1024);
    const img = detectImage(file.buffer);
    if (!img) throw badRequest("Envie o logotipo em PNG, JPEG ou WebP (até 1 MB).");
    const stored = await storePrivateFile(app.ctx, { buffer: file.buffer, originalName: file.filename, mimeType: img.mime, purpose: "logo", userId: admin.id, extension: img.ext });
    const branding = await settings.get("branding");
    const field = logoField(req);
    await settings.set("branding", { ...branding, [field]: stored.id }, admin.id);
    await audit(req, "settings.logo_updated", { metadata: { variant: field === "logoDarkFileId" ? "dark" : "light" } });
    return { ok: true };
  });

  app.delete("/api/admin/settings/logo", async (req) => {
    const admin = requireRole(req, "admin");
    const branding = await settings.get("branding");
    const field = logoField(req);
    await settings.set("branding", { ...branding, [field]: null }, admin.id);
    await audit(req, "settings.logo_removed", { metadata: { variant: field === "logoDarkFileId" ? "dark" : "light" } });
    return { ok: true };
  });

  app.post("/api/admin/settings/test-email", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req) => {
    const admin = requireRole(req, "admin");
    if (!mailer.configured) throw badRequest("SMTP não configurado no servidor (variáveis SMTP_HOST, SMTP_USER...).");
    await mailer.send({ to: admin.email, subject: "Teste de e-mail — LIFE CLASS", text: "Se você recebeu esta mensagem, o envio de e-mails está funcionando." });
    return { ok: true };
  });

  // ------------------------------------------------------------------ Termos de uso e confidencialidade
  app.get("/api/admin/terms", async (req) => {
    requireRole(req, "admin");
    const rows = await db.select().from(termsVersions).orderBy(desc(termsVersions.publishedAt));
    const out = [];
    for (const t of rows) {
      const acc = await db.select({ id: termsAcceptances.id }).from(termsAcceptances).where(eq(termsAcceptances.termsVersionId, t.id));
      out.push({ ...t, acceptances: acc.length });
    }
    return out;
  });

  app.post("/api/admin/terms", async (req) => {
    const admin = requireRole(req, "admin");
    const body = parse(
      z.object({ version: z.string().trim().min(1).max(20), title: z.string().trim().min(3).max(200), body: z.string().trim().min(20).max(50_000) }),
      req.body,
    );
    const [dup] = await db.select({ id: termsVersions.id }).from(termsVersions).where(eq(termsVersions.version, body.version));
    if (dup) throw conflict("Já existe uma versão com este número.");
    // A nova versão passa a valer imediatamente: todos precisam registrar ciência novamente.
    const row = await db.transaction(async (tx) => {
      await tx.update(termsVersions).set({ isCurrent: false });
      const [r] = await tx.insert(termsVersions).values({ ...body, isCurrent: true, createdBy: admin.id }).returning();
      return r!;
    });
    await audit(req, "terms.published", { targetType: "terms", targetId: row.id, metadata: { version: body.version } });
    return row;
  });

  // ------------------------------------------------------------------ Biblioteca (gestão)
  const libraryBody = z.object({
    title: z.string().trim().min(2).max(250),
    author: z.string().trim().max(200).default(""),
    category: z.string().trim().max(80).default(""),
    theme: z.string().trim().max(120).default(""),
    description: z.string().trim().max(5000).default(""),
    level: z.enum(LEVELS).default("basico"),
    estimatedMinutes: z.number().int().min(1).max(100_000).nullable().optional(),
    type: z.enum(LIBRARY_TYPES).default("book"),
    license: z.enum(LIBRARY_LICENSES).default("external_only"),
    coverColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
    externalUrl: z
      .string()
      .trim()
      .url()
      .refine((v) => /^https:\/\//i.test(v), "Use um link https.")
      .nullable()
      .optional(),
    allowDownload: z.boolean().default(false),
    areaId: z.string().uuid().nullable().optional(),
    status: z.enum(PUBLICATION_STATUS).default("published"),
  });

  function checkLicense(b: { license?: string; allowDownload?: boolean }) {
    if (b.allowDownload && b.license === "external_only") {
      throw badRequest("Download só é permitido para conteúdo próprio, licenciado ou de licença aberta.");
    }
  }

  app.get("/api/admin/library", async (req) => {
    requireRole(req, "admin");
    return db.select().from(libraryItems).orderBy(asc(libraryItems.sortOrder), asc(libraryItems.title));
  });

  app.post("/api/admin/library", async (req) => {
    const admin = requireRole(req, "admin");
    const body = parse(libraryBody, req.body);
    checkLicense(body);
    const [row] = await db.insert(libraryItems).values({ ...body, createdBy: admin.id }).returning();
    await audit(req, "library.created", { targetType: "library_item", targetId: row!.id });
    return row;
  });

  app.patch("/api/admin/library/:id", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(libraryBody.partial(), req.body);
    const [cur] = await db.select().from(libraryItems).where(eq(libraryItems.id, id));
    if (!cur) throw notFound();
    checkLicense({ license: body.license ?? cur.license, allowDownload: body.allowDownload ?? cur.allowDownload });
    const [row] = await db.update(libraryItems).set({ ...body, updatedAt: new Date() }).where(eq(libraryItems.id, id)).returning();
    await audit(req, "library.updated", { targetType: "library_item", targetId: id });
    return row;
  });

  app.delete("/api/admin/library/:id", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    await db.delete(libraryItems).where(eq(libraryItems.id, id));
    await audit(req, "library.deleted", { targetType: "library_item", targetId: id });
    return { ok: true };
  });

  app.post("/api/admin/library/:id/file", async (req) => {
    const admin = requireRole(req, "admin");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, id));
    if (!item) throw notFound();
    if (item.license === "external_only") throw badRequest("Obras sem autorização de distribuição não podem ter arquivo hospedado. Use o link oficial.");
    const file = await readSingleFile(req, 50 * 1024 * 1024);
    if (!isPdf(file.buffer)) throw badRequest("Envie o material em PDF.");
    const stored = await storePrivateFile(app.ctx, { buffer: file.buffer, originalName: file.filename, mimeType: "application/pdf", purpose: "library", userId: admin.id, extension: "pdf" });
    await db.update(libraryItems).set({ fileId: stored.id, updatedAt: new Date() }).where(eq(libraryItems.id, id));
    await audit(req, "library.file_uploaded", { targetType: "library_item", targetId: id });
    return { ok: true };
  });

  app.post("/api/admin/library/:id/cover", async (req) => {
    const admin = requireRole(req, "admin");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const file = await readSingleFile(req, 3 * 1024 * 1024);
    const img = detectImage(file.buffer);
    if (!img) throw badRequest("Envie uma imagem PNG, JPEG ou WebP.");
    const stored = await storePrivateFile(app.ctx, { buffer: file.buffer, originalName: file.filename, mimeType: img.mime, purpose: "cover", userId: admin.id, extension: img.ext });
    await db.update(libraryItems).set({ coverFileId: stored.id, updatedAt: new Date() }).where(eq(libraryItems.id, id));
    return { ok: true };
  });

}
