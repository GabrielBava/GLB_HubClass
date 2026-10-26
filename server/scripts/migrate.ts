/**
 * Aplica as migrações do banco. Na Vercel roda durante o build (npm run vercel-build), com a conexão
 * direta do Neon (DATABASE_URL_UNPOOLED) quando disponível. Não exige APP_SECRET.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "../db/client.js";

if (!process.env.VERCEL && existsSync(".env")) process.loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || null;
if (!databaseUrl && process.env.VERCEL) {
  console.error("DATABASE_URL não definido: conecte o banco Neon ao projeto na Vercel (Storage › Neon) antes do deploy.");
  process.exit(1);
}
const database = await openDatabase({ databaseUrl, embeddedDir: path.resolve(process.env.DATA_DIR ?? "./data", "pglite") });
await database.migrate();
console.log(`Migrações aplicadas (${database.kind === "postgres" ? "PostgreSQL" : "banco embutido"}).`);
await database.close();
