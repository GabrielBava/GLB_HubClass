/**
 * Cria o primeiro administrador a partir de BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD (e opcionalmente
 * BOOTSTRAP_ADMIN_NAME). Na Vercel roda no build, depois das migrações. Sem as variáveis, ou se já existe
 * administrador, não faz nada. A senha nunca é gravada no código nem no log.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "../db/client.js";
import { bootstrapAdmin } from "../services/bootstrap.js";

if (!process.env.VERCEL && existsSync(".env")) process.loadEnvFile(".env");

const env = process.env;
if (!env.BOOTSTRAP_ADMIN_EMAIL && !env.BOOTSTRAP_ADMIN_PASSWORD) process.exit(0);

const databaseUrl = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || null;
if (!databaseUrl && env.VERCEL) {
  console.warn("AVISO: administrador inicial não criado porque o banco ainda não está conectado.");
  process.exit(0);
}
const database = await openDatabase({ databaseUrl, embeddedDir: path.resolve(env.DATA_DIR ?? "./data", "pglite") });
try {
  const result = await bootstrapAdmin(database.db, { email: env.BOOTSTRAP_ADMIN_EMAIL, password: env.BOOTSTRAP_ADMIN_PASSWORD, name: env.BOOTSTRAP_ADMIN_NAME });
  console.log(result.message);
  for (const w of result.warnings) console.warn(`AVISO sobre a senha inicial: ${w} Recomenda-se trocá-la em "Meu perfil e segurança".`);
} catch (err) {
  console.error(`Falha ao criar o administrador inicial: ${(err as Error).message}`);
  process.exit(1);
} finally {
  await database.close();
}
