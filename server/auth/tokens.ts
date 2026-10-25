import { and, eq, gt, isNull } from "drizzle-orm";
import type { DB } from "../db/client.js";
import { authTokens } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";

type TokenType = "invite" | "password_reset";

/** Cria um token de uso único. Só o hash fica no banco; o valor bruto vai no link enviado. */
export async function issueAuthToken(db: DB, opts: { userId: string; type: TokenType; ttlMinutes: number; createdBy?: string | null }) {
  // Tokens anteriores do mesmo tipo deixam de valer.
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, opts.userId), eq(authTokens.type, opts.type), isNull(authTokens.usedAt)));
  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId: opts.userId,
    type: opts.type,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + opts.ttlMinutes * 60_000),
    createdBy: opts.createdBy ?? null,
  });
  return token;
}

export async function findValidToken(db: DB, token: string, type: TokenType) {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.type, type), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}

/** Marca como usado de forma atômica: só uma requisição concorrente consegue consumir. */
export async function consumeToken(db: DB, id: string): Promise<boolean> {
  const rows = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.id, id), isNull(authTokens.usedAt)))
    .returning({ id: authTokens.id });
  return rows.length === 1;
}

export async function invalidateUserTokens(db: DB, userId: string) {
  await db.update(authTokens).set({ usedAt: new Date() }).where(and(eq(authTokens.userId, userId), isNull(authTokens.usedAt)));
}
