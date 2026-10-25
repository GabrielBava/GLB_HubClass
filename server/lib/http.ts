import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "../../shared/domain.js";
import type { AuthUser } from "../auth/sessions.js";
import { writeAudit, type AuditEntry } from "../services/audit.js";
import { forbidden, unauthorized } from "./errors.js";

/** Usuário autenticado (com MFA concluído, quando exigido). Lança 401/403 caso contrário. */
export function currentUser(req: FastifyRequest): AuthUser {
  const auth = req.auth;
  if (!auth) throw unauthorized();
  if (!auth.mfaSatisfied) throw forbidden("Conclua a verificação em duas etapas para continuar.", "mfa_required");
  return auth.user;
}

export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthUser {
  const user = currentUser(req);
  if (!roles.includes(user.role)) {
    void audit(req, "authz.denied", { outcome: "denied", metadata: { route: req.routeOptions.url, method: req.method } });
    throw forbidden();
  }
  return user;
}

export async function audit(req: FastifyRequest, action: string, entry: Omit<AuditEntry, "action"> = {}) {
  try {
    await writeAudit(req.server.ctx.db, {
      actorId: req.auth?.user.id ?? null,
      actorEmail: req.auth?.user.email ?? null,
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
      ...entry,
      action,
    });
  } catch (err) {
    req.log.error({ err, action }, "falha ao gravar auditoria");
  }
}

export function noStore(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store, private");
}
