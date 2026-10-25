import type { DB } from "../db/client.js";
import { auditLogs } from "../db/schema.js";

export interface AuditEntry {
  action: string;
  outcome?: "success" | "failure" | "denied";
  actorId?: string | null;
  actorEmail?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(db: DB, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    action: entry.action,
    outcome: entry.outcome ?? "success",
    actorId: entry.actorId ?? null,
    actorEmail: entry.actorEmail ?? null,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ? entry.userAgent.slice(0, 300) : null,
    metadata: entry.metadata ?? {},
  });
}
