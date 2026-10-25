/**
 * Cria o primeiro administrador (ou reenvia o convite) sem senha fixa:
 *   npm run admin:create -- --email pessoa@empresa.com.br --name "Nome Completo"
 * O link de convite é de uso único e expira conforme a configuração de segurança.
 */
import { eq, sql } from "drizzle-orm";
import { parseArgs } from "node:util";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { users } from "../db/schema.js";
import { issueAuthToken } from "../auth/tokens.js";
import { SettingsService } from "../services/settings.js";
import { writeAudit } from "../services/audit.js";

const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !name || name.length < 3) {
  console.error('Uso: npm run admin:create -- --email pessoa@empresa.com.br --name "Nome Completo"');
  process.exit(1);
}

const config = loadConfig();
const database = await openDatabase({ databaseUrl: config.databaseUrl, embeddedDir: config.embeddedDbDir });
await database.migrate();
const db = database.db;
const settings = new SettingsService(db);

let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
if (user && user.status !== "invited") {
  console.error("Já existe um usuário ativo/desativado com este e-mail. Use a tela de usuários para alterar o perfil.");
  await database.close();
  process.exit(1);
}
if (!user) {
  [user] = await db.insert(users).values({ email, name, role: "admin", status: "invited" }).returning();
} else {
  await db.update(users).set({ role: "admin", name }).where(eq(users.id, user.id));
}
const security = await settings.get("security");
const token = await issueAuthToken(db, { userId: user!.id, type: "invite", ttlMinutes: security.inviteExpiryHours * 60 });
await writeAudit(db, { action: "user.admin_bootstrap", targetType: "user", targetId: user!.id, metadata: { email, via: "cli" } });
console.log(`\nAdministrador: ${name} <${email}>`);
console.log(`Link de primeiro acesso (uso único, válido por ${security.inviteExpiryHours} h):\n${config.appOrigin}/convite/${token}\n`);
console.log("Envie o link por um canal seguro. No primeiro login será exigida a verificação em duas etapas (MFA).");
await database.close();
