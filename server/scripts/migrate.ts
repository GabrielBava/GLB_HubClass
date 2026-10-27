/**
 * Aplica as migrações do banco. Na Vercel roda durante o build (npm run vercel-build), com a conexão
 * direta do Neon (DATABASE_URL_UNPOOLED) quando disponível. Não exige APP_SECRET.
 * Sem banco conectado ainda (primeiro deploy logo após importar o projeto), o build segue sem migrar:
 * a plataforma avisa que falta o banco, e as tabelas são criadas no deploy seguinte.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "../db/client.js";

if (!process.env.VERCEL && existsSync(".env")) process.loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || null;
if (!databaseUrl && process.env.VERCEL) {
  console.warn(
    "AVISO: banco de dados não conectado (DATABASE_URL ausente). O deploy continua, mas a plataforma só funciona depois de " +
      "conectar o Neon em Storage e publicar de novo (Deployments › Redeploy). As tabelas são criadas nesse novo deploy.",
  );
  process.exit(0);
}
const database = await openDatabase({ databaseUrl, embeddedDir: path.resolve(process.env.DATA_DIR ?? "./data", "pglite") });
try {
  await database.migrate();
} catch (err) {
  console.error(`Falha ao aplicar as migrações no banco: ${(err as Error).message}`);
  console.error("Confira se o Neon está conectado a este ambiente (Production/Preview) em Storage e se o banco está ativo.");
  process.exit(1);
}
console.log(`Migrações aplicadas (${database.kind === "postgres" ? "PostgreSQL" : "banco embutido"}).`);
await database.close();
