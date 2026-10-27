import { count, eq, sql } from "drizzle-orm";
import { hashPassword, passwordProblems } from "../auth/password.js";
import type { DB } from "../db/client.js";
import { passwordHistory, users } from "../db/schema.js";
import { writeAudit } from "./audit.js";

export interface BootstrapResult {
  status: "skipped" | "created" | "updated";
  message: string;
  /** Regras da política de senha que a senha inicial não atende (a escolha é de quem faz o deploy). */
  warnings: string[];
}

/** "gabriel.bavaresco" → "Gabriel Bavaresco" (nome provisório, editável no perfil). */
function nameFromEmail(email: string) {
  return (email.split("@")[0] ?? "")
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/**
 * Primeiro administrador a partir de variáveis de ambiente (BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD),
 * definidas no painel da hospedagem e nunca no código. Só age enquanto não existe nenhum administrador:
 * os deploys seguintes não alteram a senha. A verificação em duas etapas continua obrigatória no primeiro login.
 */
export async function bootstrapAdmin(db: DB, opts: { email?: string; password?: string; name?: string }): Promise<BootstrapResult> {
  const email = opts.email?.trim().toLowerCase();
  const password = opts.password ?? "";
  if (!email || !password) return { status: "skipped", message: "BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD não definidos.", warnings: [] };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("BOOTSTRAP_ADMIN_EMAIL inválido.");
  // Requisitos mínimos inegociáveis; as demais regras da política viram avisos no log do deploy.
  if (password.length < 10 || !/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD precisa de pelo menos 10 caracteres, com letras e números.");
  }
  const name = opts.name?.trim() || nameFromEmail(email);
  const warnings = passwordProblems(password, { minLength: 10, name, email });

  const [admins] = await db.select({ n: count() }).from(users).where(eq(users.role, "admin"));
  if (Number(admins?.n ?? 0) > 0) {
    return { status: "skipped", message: "Já existe administrador: nada foi alterado (pode remover as variáveis BOOTSTRAP_ADMIN_*).", warnings: [] };
  }

  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  let userId: string;
  let status: BootstrapResult["status"];
  if (existing) {
    await db.update(users).set({ role: "admin", status: "active", name, passwordHash, updatedAt: new Date() }).where(eq(users.id, existing.id));
    userId = existing.id;
    status = "updated";
  } else {
    const [created] = await db.insert(users).values({ email, name, role: "admin", status: "active", passwordHash }).returning();
    userId = created!.id;
    status = "created";
  }
  await db.insert(passwordHistory).values({ userId, hash: passwordHash });
  await writeAudit(db, { action: "user.admin_bootstrap", targetType: "user", targetId: userId, metadata: { email, via: "env" } });
  return {
    status,
    message: `Administrador ${email} ${status === "created" ? "criado" : "atualizado"}. No primeiro login será pedida a verificação em duas etapas.`,
    warnings,
  };
}
