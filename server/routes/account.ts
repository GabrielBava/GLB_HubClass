import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { userCode } from "../../shared/domain.js";
import {
  attempts,
  bookmarks,
  certificates,
  contentProgress,
  enrollments,
  feedbacks,
  files,
  highlights,
  notes,
  notifications,
  practicalSubmissions,
  termsAcceptances,
  termsVersions,
  trackJobTitles,
  users,
} from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { audit, currentUser } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { learnerContext } from "../services/access.js";
import { evaluateTrackAccess, loadCatalogIndex, trackEstimatedMinutes } from "../services/catalog.js";
import { currentTerms, hasAcceptedCurrentTerms } from "../services/me.js";

export async function accountRoutes(app: FastifyInstance) {
  const { db, settings, secrets } = app.ctx;

  // ------------------------------------------------------------- Primeiro acesso
  app.get("/api/onboarding", async (req) => {
    const lc = await learnerContext(req);
    const onboarding = await settings.get("onboarding");
    const branding = await settings.get("branding");
    const privacy = await settings.get("privacy");
    const reading = await settings.get("reading");
    const terms = await currentTerms(db);
    const accepted = await hasAcceptedCurrentTerms(db, lc.user.id);

    // Minha jornada: obrigatórias liberadas, atribuídas e recomendadas para o cargo.
    const index = await loadCatalogIndex(db, reading);
    const enr = await db.select().from(enrollments).where(eq(enrollments.userId, lc.user.id));
    const recommendedIds = lc.user.jobTitleId
      ? new Set((await db.select().from(trackJobTitles).where(eq(trackJobTitles.jobTitleId, lc.user.jobTitleId))).map((r) => r.trackId))
      : new Set<string>();
    const mandatory: unknown[] = [];
    const recommended: unknown[] = [];
    for (const t of index.tracks) {
      const area = index.areaById.get(t.areaId);
      if (!area || t.status !== "published" || !area.isVisible) continue;
      const access = evaluateTrackAccess(lc.evaluator, area, t, index.modulesByTrack.get(t.id) ?? [], (m) => index.contentsByModule.get(m) ?? []);
      if (access.access === "none") continue;
      const e = enr.find((x) => x.trackId === t.id);
      const item = {
        id: t.id,
        title: t.title,
        summary: t.summary,
        areaName: area.name,
        areaColor: area.color,
        estimatedMinutes: trackEstimatedMinutes(index, t),
        dueDate: e?.dueDate ?? null,
      };
      if (t.mode === "obrigatoria" || e?.isMandatory) mandatory.push(item);
      else if (recommendedIds.has(t.id) || e) recommended.push(item);
    }

    return {
      platformName: branding.platformName,
      organizationName: branding.organizationName,
      welcomeMessage: onboarding.welcomeMessage,
      supportContact: onboarding.supportContact,
      dataProtectionContact: privacy.dataProtectionContact,
      terms: terms ? { id: terms.id, version: terms.version, title: terms.title, body: terms.body, publishedAt: terms.publishedAt } : null,
      termsAccepted: accepted,
      completed: lc.user.onboardingCompletedAt !== null,
      journey: { mandatory, recommended: recommended.slice(0, 8) },
    };
  });

  app.post("/api/onboarding/terms", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const user = currentUser(req);
    const { termsVersionId, accepted } = parse(z.object({ termsVersionId: z.string().uuid(), accepted: z.literal(true) }), req.body);
    void accepted;
    const terms = await currentTerms(db);
    if (!terms || terms.id !== termsVersionId) throw badRequest("Os termos foram atualizados. Leia a versão atual.");
    await db
      .insert(termsAcceptances)
      .values({ userId: user.id, termsVersionId, ipHash: secrets.hmac(req.ip), userAgent: req.headers["user-agent"]?.slice(0, 300) ?? null })
      .onConflictDoNothing();
    await audit(req, "terms.accepted", { targetType: "terms", targetId: termsVersionId, metadata: { version: terms.version } });
    return { ok: true, version: terms.version, acceptedAt: new Date() };
  });

  app.post("/api/onboarding/complete", async (req) => {
    const user = currentUser(req);
    if (!(await hasAcceptedCurrentTerms(db, user.id))) throw badRequest("Confirme a ciência dos termos para concluir.");
    if (!user.onboardingCompletedAt) {
      await db.update(users).set({ onboardingCompletedAt: new Date() }).where(eq(users.id, user.id));
      await audit(req, "onboarding.completed");
    }
    return { ok: true };
  });

  // ------------------------------------------------------------- Perfil e privacidade
  app.get("/api/profile", async (req) => {
    const me = currentUser(req);
    const [user] = await db.select().from(users).where(eq(users.id, me.id));
    if (!user) throw notFound();
    const accepted = await db
      .select({ version: termsVersions.version, acceptedAt: termsAcceptances.acceptedAt })
      .from(termsAcceptances)
      .innerJoin(termsVersions, eq(termsVersions.id, termsAcceptances.termsVersionId))
      .where(eq(termsAcceptances.userId, me.id))
      .orderBy(desc(termsAcceptances.acceptedAt));
    const privacy = await settings.get("privacy");
    return {
      name: user.name,
      email: user.email,
      code: userCode(user.seq),
      role: user.role,
      mfaEnabled: user.mfaEnabled,
      mfaEnabledAt: user.mfaEnabledAt,
      passwordChangedAt: user.passwordChangedAt,
      lastLoginAt: user.lastLoginAt,
      preferences: { emailNotifications: user.preferences.emailNotifications !== false },
      termsAcceptances: accepted,
      privacy: {
        contact: privacy.dataProtectionContact,
        retention: {
          readingSessionsDays: privacy.readingSessionRetentionDays,
          notificationsDays: privacy.notificationRetentionDays,
          auditDays: privacy.auditRetentionDays,
        },
      },
    };
  });

  app.patch("/api/profile/preferences", async (req) => {
    const me = currentUser(req);
    const body = parse(z.object({ emailNotifications: z.boolean() }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, me.id));
    await db
      .update(users)
      .set({ preferences: { ...(user?.preferences ?? {}), emailNotifications: body.emailNotifications }, updatedAt: new Date() })
      .where(eq(users.id, me.id));
    return { ok: true };
  });

  /** Exportação dos dados pessoais do próprio colaborador (direito de acesso — LGPD). */
  app.get("/api/profile/data-export", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    const me = currentUser(req);
    const [user] = await db.select().from(users).where(eq(users.id, me.id));
    const data = {
      geradoEm: new Date().toISOString(),
      perfil: user
        ? {
            nome: user.name,
            email: user.email,
            identificador: userCode(user.seq),
            perfil: user.role,
            criadoEm: user.createdAt,
            ultimoAcesso: user.lastLoginAt,
            preferencias: user.preferences,
          }
        : null,
      matriculas: await db.select().from(enrollments).where(eq(enrollments.userId, me.id)),
      progressoDeLeitura: await db.select().from(contentProgress).where(eq(contentProgress.userId, me.id)),
      anotacoes: await db.select().from(notes).where(eq(notes.userId, me.id)),
      marcadores: await db.select().from(bookmarks).where(eq(bookmarks.userId, me.id)),
      destaques: await db.select().from(highlights).where(eq(highlights.userId, me.id)),
      tentativasDeAvaliacao: await db
        .select({ id: attempts.id, avaliacao: attempts.assessmentId, numero: attempts.attemptNumber, nota: attempts.score, aprovado: attempts.passed, enviadaEm: attempts.submittedAt })
        .from(attempts)
        .where(eq(attempts.userId, me.id)),
      atividadesPraticas: await db.select().from(practicalSubmissions).where(eq(practicalSubmissions.userId, me.id)),
      feedbacksRecebidos: await db.select().from(feedbacks).where(eq(feedbacks.userId, me.id)),
      certificados: await db.select().from(certificates).where(eq(certificates.userId, me.id)),
      aceitesDeTermos: await db
        .select({ termos: termsAcceptances.termsVersionId, aceitoEm: termsAcceptances.acceptedAt })
        .from(termsAcceptances)
        .where(eq(termsAcceptances.userId, me.id)),
      notificacoes: await db.select().from(notifications).where(eq(notifications.userId, me.id)),
    };
    await audit(req, "privacy.data_export");
    reply.header("Content-Type", "application/json; charset=utf-8").header("Content-Disposition", 'attachment; filename="meus-dados-lifeclass.json"');
    return JSON.stringify(data, null, 2);
  });

  /** Imagens de capa (trilhas e biblioteca): só para usuários autenticados. */
  app.get("/api/files/:id/image", async (req, reply) => {
    currentUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [file] = await db.select().from(files).where(and(eq(files.id, id), eq(files.purpose, "cover")));
    if (!file) throw notFound();
    const data = await app.ctx.storage.get(file.storageKey);
    reply.header("Content-Type", file.mimeType).header("Cache-Control", "private, max-age=3600").header("X-Content-Type-Options", "nosniff");
    return reply.send(data);
  });
}
