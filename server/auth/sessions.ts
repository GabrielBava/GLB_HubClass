import { and, eq, isNull, ne } from "drizzle-orm";
import type { Role } from "../../shared/domain.js";
import type { SecuritySettings } from "../../shared/settings.js";
import type { DB } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";

/** Perfis que precisam de autenticação multifator. */
export const MFA_REQUIRED_ROLES: readonly Role[] = ["admin", "leader"];

export function sessionCookieName(secure: boolean) {
  // O prefixo __Host- exige Secure, Path=/ e nenhum Domain: impede que subdomínios sobrescrevam o cookie.
  return secure ? "__Host-lc_session" : "lc_session";
}

export interface AuthUser {
  id: string;
  seq: number;
  email: string;
  name: string;
  role: Role;
  teamId: string | null;
  departmentId: string | null;
  jobTitleId: string | null;
  mfaEnabled: boolean;
  onboardingCompletedAt: Date | null;
}

export interface AuthState {
  session: { id: string; csrfToken: string; mfaVerifiedAt: Date | null; createdAt: Date; expiresAt: Date };
  user: AuthUser;
  mfaRequired: boolean;
  mfaSatisfied: boolean;
}

export async function createSession(
  db: DB,
  opts: { userId: string; ip?: string; userAgent?: string; mfaVerified: boolean; security: SecuritySettings },
) {
  const token = randomToken(32);
  const now = Date.now();
  const [session] = await db
    .insert(sessions)
    .values({
      tokenHash: sha256(token),
      userId: opts.userId,
      csrfToken: randomToken(24),
      idleExpiresAt: new Date(now + opts.security.sessionIdleMinutes * 60_000),
      expiresAt: new Date(now + opts.security.sessionAbsoluteHours * 3_600_000),
      mfaVerifiedAt: opts.mfaVerified ? new Date(now) : null,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 300) ?? null,
    })
    .returning();
  return { token, session: session! };
}

/**
 * Resolve o cookie de sessão. Sessões revogadas, expiradas (por inatividade ou prazo absoluto)
 * ou de usuários que não estão ativos são recusadas.
 */
export async function resolveSession(db: DB, token: string, security: SecuritySettings): Promise<AuthState | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const { session, user } = row;
  const now = Date.now();
  if (session.revokedAt || session.expiresAt.getTime() <= now || session.idleExpiresAt.getTime() <= now) return null;
  if (user.status !== "active") return null;

  // Renova a janela de inatividade no máximo uma vez por minuto.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    const idle = Math.min(now + security.sessionIdleMinutes * 60_000, session.expiresAt.getTime());
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now), idleExpiresAt: new Date(idle) })
      .where(eq(sessions.id, session.id));
  }

  const mfaRequired = MFA_REQUIRED_ROLES.includes(user.role) || user.mfaEnabled;
  return {
    session: {
      id: session.id,
      csrfToken: session.csrfToken,
      mfaVerifiedAt: session.mfaVerifiedAt,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    },
    user: {
      id: user.id,
      seq: user.seq,
      email: user.email,
      name: user.name,
      role: user.role,
      teamId: user.teamId,
      departmentId: user.departmentId,
      jobTitleId: user.jobTitleId,
      mfaEnabled: user.mfaEnabled,
      onboardingCompletedAt: user.onboardingCompletedAt,
    },
    mfaRequired,
    mfaSatisfied: !mfaRequired || (user.mfaEnabled && session.mfaVerifiedAt !== null),
  };
}

export async function revokeSession(db: DB, sessionId: string, reason: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeUserSessions(db: DB, userId: string, reason: string, exceptSessionId?: string) {
  const where = exceptSessionId
    ? and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, exceptSessionId))
    : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
  const revoked = await db.update(sessions).set({ revokedAt: new Date(), revokedReason: reason }).where(where).returning({ id: sessions.id });
  return revoked.length;
}
