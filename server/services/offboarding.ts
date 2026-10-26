import { and, eq, isNotNull, lte, ne } from "drizzle-orm";
import { revokeUserSessions } from "../auth/sessions.js";
import { invalidateUserTokens } from "../auth/tokens.js";
import type { DB } from "../db/client.js";
import { leaderAreas, teamLeaders, users } from "../db/schema.js";
import { writeAudit } from "./audit.js";

/**
 * Desligamento de colaborador: tranca o acesso imediatamente e preserva o histórico de aprendizagem.
 * - status "desligado/desativado" (login e sessões recusados);
 * - todas as sessões encerradas e links de convite ou redefinição invalidados;
 * - liderança removida (equipes e áreas), para que nenhum acesso de gestão permaneça.
 * A anonimização (LGPD) continua sendo uma ação separada, feita depois do prazo definido pela empresa.
 */
export async function executeOffboarding(db: DB, userId: string, opts: { by: string | null; reason: string | null; at?: Date }) {
  const at = opts.at ?? new Date();
  await db
    .update(users)
    .set({ status: "inactive", deactivatedAt: at, offboardAt: at, offboardReason: opts.reason, offboardedBy: opts.by, updatedAt: new Date() })
    .where(eq(users.id, userId));
  const sessionsRevoked = await revokeUserSessions(db, userId, "offboarded");
  await invalidateUserTokens(db, userId);
  const teams = await db.delete(teamLeaders).where(eq(teamLeaders.userId, userId)).returning();
  const areas = await db.delete(leaderAreas).where(eq(leaderAreas.userId, userId)).returning();
  return { sessionsRevoked, leaderTeamsRemoved: teams.length, leaderAreasRemoved: areas.length };
}

/** O desligamento agendado já venceu? (usado no login e a cada requisição, antes da rotina periódica). */
export function offboardingDue(user: { offboardAt: Date | null; status: string }, now = Date.now()) {
  return !!user.offboardAt && user.offboardAt.getTime() <= now && user.status !== "inactive";
}

/** Executa os desligamentos agendados cuja data chegou. Retorna quantos foram aplicados. */
export async function applyDueOffboardings(db: DB): Promise<number> {
  const due = await db
    .select()
    .from(users)
    .where(and(isNotNull(users.offboardAt), lte(users.offboardAt, new Date()), ne(users.status, "inactive")));
  for (const u of due) {
    const result = await executeOffboarding(db, u.id, { by: u.offboardedBy, reason: u.offboardReason, at: u.offboardAt! });
    await writeAudit(db, { action: "user.offboarded", targetType: "user", targetId: u.id, metadata: { scheduled: true, reason: u.offboardReason, ...result } });
  }
  return due.length;
}
