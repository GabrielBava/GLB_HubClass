import { and, lt, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { DB } from "../db/client.js";
import { auditLogs, notifications, readingSessions, sessions } from "../db/schema.js";
import { applyDueOffboardings } from "./offboarding.js";

const DAY = 86_400_000;

/**
 * Política de retenção: remove sessões encerradas, sessões de leitura e notificações antigas,
 * e registros de auditoria além do prazo configurado (a exclusão de auditoria só é aceita
 * por esta rotina, que habilita a variável de sessão exigida pelo gatilho do banco).
 */
export async function applyRetention(db: DB, privacy: { auditRetentionDays: number; readingSessionRetentionDays: number; notificationRetentionDays: number }) {
  const now = Date.now();
  const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, new Date(now - 30 * DAY))).returning({ id: sessions.id });
  const oldReading = await db
    .delete(readingSessions)
    .where(lt(readingSessions.startedAt, new Date(now - privacy.readingSessionRetentionDays * DAY)))
    .returning({ id: readingSessions.id });
  const oldNotifications = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, new Date(now - privacy.notificationRetentionDays * DAY)))
    .returning({ id: notifications.id });
  const audit = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lifeclass.audit_purge', 'on', true)`);
    return tx.delete(auditLogs).where(and(lt(auditLogs.at, new Date(now - privacy.auditRetentionDays * DAY)))).returning({ id: auditLogs.id });
  });
  return { sessions: expiredSessions.length, readingSessions: oldReading.length, notifications: oldNotifications.length, auditLogs: audit.length };
}

/** Rotinas periódicas em processo (uma vez por dia). */
export function startMaintenance(app: FastifyInstance) {
  const run = async () => {
    try {
      const privacy = await app.ctx.settings.get("privacy");
      const result = await applyRetention(app.ctx.db, privacy);
      app.log.info({ result }, "retenção de dados aplicada");
    } catch (err) {
      app.log.error({ err }, "falha na rotina de retenção");
    }
  };
  const timer = setInterval(run, DAY);
  timer.unref();
  setTimeout(run, 60_000).unref();
  // Desligamentos agendados: verificados a cada 10 minutos (login e sessões já recusam no horário exato).
  const offboard = setInterval(() => {
    applyDueOffboardings(app.ctx.db)
      .then((n) => n && app.log.info({ n }, "desligamentos agendados executados"))
      .catch((err) => app.log.error({ err }, "falha ao executar desligamentos agendados"));
  }, 10 * 60_000);
  offboard.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    clearInterval(offboard);
  });
}
