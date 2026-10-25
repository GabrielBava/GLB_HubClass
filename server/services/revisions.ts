import type { DB } from "../db/client.js";
import { entityRevisions } from "../db/schema.js";

/** Registra uma fotografia da entidade a cada alteração (histórico de versões e alterações). */
export async function recordRevision(db: DB, entityType: string, entityId: string, action: string, snapshot: object, userId: string | null) {
  await db.insert(entityRevisions).values({ entityType, entityId, action, snapshot: JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>, changedBy: userId });
}
