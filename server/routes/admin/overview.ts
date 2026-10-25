import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { attempts, auditLogs, contentVersions, practicalSubmissions, requests, sessions, tracks, users } from "../../db/schema.js";
import { requireRole } from "../../lib/http.js";

export async function adminOverviewRoutes(app: FastifyInstance) {
  const { db, config, mailer, database } = app.ctx;

  app.get("/api/admin/overview", async (req) => {
    requireRole(req, "admin");
    const byStatus = await db.select({ status: users.status, n: count() }).from(users).where(isNull(users.anonymizedAt)).groupBy(users.status);
    const trackStatus = await db.select({ status: tracks.status, n: count() }).from(tracks).groupBy(tracks.status);
    const [activeSessions] = await db
      .select({ n: count() })
      .from(sessions)
      .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()), gt(sessions.idleExpiresAt, new Date())));
    const [failedDocs] = await db.select({ n: count() }).from(contentVersions).where(eq(contentVersions.processingStatus, "failed"));
    const [processing] = await db.select({ n: count() }).from(contentVersions).where(eq(contentVersions.processingStatus, "processing"));
    const [openRequests] = await db.select({ n: count() }).from(requests).where(eq(requests.status, "open"));
    const [pendingSubs] = await db.select({ n: count() }).from(practicalSubmissions).where(eq(practicalSubmissions.status, "submitted"));
    const [pendingReviews] = await db.select({ n: count() }).from(attempts).where(eq(attempts.status, "pending_review"));
    const [adminsWithoutMfa] = await db.select({ n: count() }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), eq(users.mfaEnabled, false)));
    const denials = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.outcome, "denied"))
      .orderBy(desc(auditLogs.at))
      .limit(8);
    const warnings: string[] = [];
    if (!mailer.configured) warnings.push("SMTP não configurado: convites e avisos por e-mail não são enviados (os links de convite aparecem para o administrador).");
    if (!config.clamav) warnings.push("Antivírus (ClamAV) não configurado: os arquivos enviados não passam por verificação de malware.");
    if (database.kind !== "postgres") warnings.push("Banco PostgreSQL embutido em uso: adequado apenas para desenvolvimento e demonstração.");
    if (!config.cookieSecure) warnings.push("Cookies sem a flag Secure (ambiente sem HTTPS). Em produção, use HTTPS.");
    if (config.storage.driver === "local") warnings.push("Arquivos em disco local: em produção, prefira armazenamento S3 privado com backup.");
    const n = (rows: { status: string; n: number }[], s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    return {
      users: { active: n(byStatus, "active"), invited: n(byStatus, "invited"), inactive: n(byStatus, "inactive") },
      tracks: { published: n(trackStatus, "published"), draft: n(trackStatus, "draft"), review: n(trackStatus, "review"), archived: n(trackStatus, "archived") },
      activeSessions: Number(activeSessions?.n ?? 0),
      documents: { failed: Number(failedDocs?.n ?? 0), processing: Number(processing?.n ?? 0) },
      openRequests: Number(openRequests?.n ?? 0),
      pendingValidations: Number(pendingSubs?.n ?? 0) + Number(pendingReviews?.n ?? 0),
      adminsWithoutMfa: Number(adminsWithoutMfa?.n ?? 0),
      recentDenials: denials.map((d) => ({ id: d.id, at: d.at, action: d.action, actorEmail: d.actorEmail, targetType: d.targetType, targetId: d.targetId })),
      warnings,
    };
  });
}
