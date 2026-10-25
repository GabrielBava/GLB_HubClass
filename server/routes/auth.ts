import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createSession, MFA_REQUIRED_ROLES, revokeSession, revokeUserSessions, sessionCookieName } from "../auth/sessions.js";
import { dummyVerify, hashPassword, passwordProblems, verifyPassword } from "../auth/password.js";
import { generateMfaSecret, generateRecoveryCodes, hashRecoveryCode, mfaEnrollmentData, verifyTotp } from "../auth/mfa.js";
import { consumeToken, findValidToken, issueAuthToken } from "../auth/tokens.js";
import { authTokens, mfaRecoveryCodes, passwordHistory, sessions, users } from "../db/schema.js";
import { badRequest, forbidden, HttpError, notFound, unauthorized } from "../lib/errors.js";
import { audit, currentUser } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { resetEmail } from "../services/emails.js";
import { buildMe } from "../services/me.js";
import { sha256 } from "../lib/crypto.js";

const INVALID_LOGIN = "E-mail ou senha inválidos.";
const LOCKED_LOGIN = "Acesso temporariamente bloqueado por excesso de tentativas. Aguarde alguns minutos ou use “Esqueceu sua senha?”.";

const emailSchema = z.string().trim().toLowerCase().email("Informe um e-mail válido.").max(254);

// Contador em memória para e-mails inexistentes: o bloqueio se comporta igual ao de contas reais,
// para que a resposta não revele quais e-mails estão cadastrados.
const ghostFailures = new Map<string, { count: number; until: number }>();

export async function authRoutes(app: FastifyInstance) {
  const { db, config, settings, secrets, mailer } = app.ctx;
  const cookieName = sessionCookieName(config.cookieSecure);

  async function startSession(req: FastifyRequest, reply: FastifyReply, user: typeof users.$inferSelect, mfaVerified: boolean) {
    const security = await settings.get("security");
    const { token } = await createSession(db, {
      userId: user.id,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      mfaVerified,
      security,
    });
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "strict",
      path: "/",
      maxAge: security.sessionAbsoluteHours * 3600,
    });
    return token;
  }

  async function loginResponse(req: FastifyRequest, reply: FastifyReply, user: typeof users.$inferSelect) {
    // MFA obrigatório para administradores e líderes; para os demais, vale quando ativado voluntariamente.
    const needsMfa = MFA_REQUIRED_ROLES.includes(user.role) || user.mfaEnabled;
    await startSession(req, reply, user, !needsMfa);
    const status = !needsMfa ? "ok" : user.mfaEnabled ? "mfa_required" : "mfa_setup_required";
    return { status };
  }

  app.get("/api/auth/me", { config: { public: true, allowPartial: true } }, async (req) => {
    if (!req.auth) return { authenticated: false };
    return buildMe(app.ctx, req.auth);
  });

  app.post(
    "/api/auth/login",
    { config: { public: true, allowPartial: true, rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = parse(z.object({ email: emailSchema, password: z.string().min(1).max(200) }), req.body);
      const security = await settings.get("security");
      const now = Date.now();

      const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${body.email}`).limit(1);
      if (!user) {
        await dummyVerify(body.password);
        const key = sha256(body.email);
        const ghost = ghostFailures.get(key) ?? { count: 0, until: 0 };
        if (ghost.until > now) throw new HttpError(429, "locked", LOCKED_LOGIN);
        ghost.count++;
        if (ghost.count >= security.maxFailedLogins) Object.assign(ghost, { count: 0, until: now + security.lockoutMinutes * 60_000 });
        ghostFailures.set(key, ghost);
        if (ghostFailures.size > 10_000) ghostFailures.clear();
        await audit(req, "auth.login", { outcome: "failure", actorEmail: body.email, metadata: { reason: "unknown_email" } });
        throw new HttpError(401, "invalid_credentials", INVALID_LOGIN);
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > now) {
        await audit(req, "auth.login", { outcome: "denied", actorId: user.id, actorEmail: user.email, metadata: { reason: "locked" } });
        throw new HttpError(429, "locked", LOCKED_LOGIN);
      }

      const valid = user.passwordHash ? await verifyPassword(user.passwordHash, body.password) : await dummyVerify(body.password);
      if (!valid || user.status !== "active") {
        if (user.status === "active") {
          const failed = user.failedLoginCount + 1;
          const lock = failed >= security.maxFailedLogins;
          await db
            .update(users)
            .set({ failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(now + security.lockoutMinutes * 60_000) : user.lockedUntil })
            .where(eq(users.id, user.id));
          if (lock) await audit(req, "auth.lockout", { outcome: "denied", actorId: user.id, actorEmail: user.email });
        }
        await audit(req, "auth.login", {
          outcome: "failure",
          actorId: user.id,
          actorEmail: user.email,
          metadata: { reason: user.status !== "active" ? `status_${user.status}` : "bad_password" },
        });
        throw new HttpError(401, "invalid_credentials", INVALID_LOGIN);
      }

      await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await audit(req, "auth.login", { actorId: user.id, actorEmail: user.email });
      return loginResponse(req, reply, user);
    },
  );

  app.post("/api/auth/logout", { config: { public: true, allowPartial: true } }, async (req, reply) => {
    if (req.auth) {
      await revokeSession(db, req.auth.session.id, "logout");
      await audit(req, "auth.logout");
    }
    reply.clearCookie(cookieName, { path: "/" });
    return { ok: true };
  });

  app.post("/api/auth/logout-all", async (req, reply) => {
    const user = currentUser(req);
    const count = await revokeUserSessions(db, user.id, "logout_all");
    await audit(req, "auth.logout_all", { metadata: { sessions: count } });
    reply.clearCookie(cookieName, { path: "/" });
    return { ok: true, revoked: count };
  });

  // -------------------------------------------------------------------------
  // MFA (TOTP)
  // -------------------------------------------------------------------------
  async function loadUser(id: string) {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw unauthorized();
    return u;
  }

  /** Troca o token da sessão após elevar o nível de autenticação (evita fixação de sessão). */
  async function elevateSession(req: FastifyRequest, reply: FastifyReply, user: typeof users.$inferSelect) {
    if (req.auth) await revokeSession(db, req.auth.session.id, "mfa_elevated");
    await startSession(req, reply, user, true);
  }

  app.post("/api/auth/mfa/setup", { config: { allowPartial: true } }, async (req) => {
    if (!req.auth) throw unauthorized();
    const user = await loadUser(req.auth.user.id);
    if (user.mfaEnabled && !req.auth.mfaSatisfied) throw forbidden("A verificação em duas etapas já está ativa. Informe o código do aplicativo.");
    const secret = generateMfaSecret();
    await db.update(users).set({ mfaPendingSecretEnc: secrets.encrypt(secret) }).where(eq(users.id, user.id));
    const branding = await settings.get("branding");
    const data = await mfaEnrollmentData(secret, user.email, branding.platformName);
    await audit(req, "auth.mfa.setup_started");
    return data;
  });

  app.post(
    "/api/auth/mfa/enable",
    { config: { allowPartial: true, rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!req.auth) throw unauthorized();
      const { code } = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
      const user = await loadUser(req.auth.user.id);
      if (user.mfaEnabled && !req.auth.mfaSatisfied) throw forbidden();
      if (!user.mfaPendingSecretEnc) throw badRequest("Inicie a configuração novamente.");
      const secret = secrets.decrypt(user.mfaPendingSecretEnc);
      const step = verifyTotp(code, secret, null);
      if (step === null) {
        await audit(req, "auth.mfa.enable", { outcome: "failure" });
        throw badRequest("Código inválido. Confira o horário do celular e tente o código atual.");
      }
      const codes = generateRecoveryCodes();
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaEnabled: true, mfaEnabledAt: new Date(), mfaLastStep: step })
          .where(eq(users.id, user.id));
        await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
        await tx.insert(mfaRecoveryCodes).values(codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })));
      });
      await elevateSession(req, reply, { ...user, mfaEnabled: true });
      await audit(req, "auth.mfa.enabled");
      return { recoveryCodes: codes };
    },
  );

  app.post(
    "/api/auth/mfa/verify",
    { config: { allowPartial: true, rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!req.auth) throw unauthorized();
      const body = parse(
        z.object({ code: z.string().trim().max(10).optional(), recoveryCode: z.string().trim().max(20).optional() }),
        req.body,
      );
      const user = await loadUser(req.auth.user.id);
      if (!user.mfaEnabled || !user.mfaSecretEnc) throw badRequest("A verificação em duas etapas ainda não foi configurada.");
      const security = await settings.get("security");
      if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new HttpError(429, "locked", LOCKED_LOGIN);

      let ok = false;
      if (body.code) {
        const step = verifyTotp(body.code, secrets.decrypt(user.mfaSecretEnc), user.mfaLastStep);
        if (step !== null) {
          ok = true;
          await db.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
        }
      } else if (body.recoveryCode) {
        const used = await db
          .update(mfaRecoveryCodes)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(mfaRecoveryCodes.userId, user.id),
              eq(mfaRecoveryCodes.codeHash, hashRecoveryCode(body.recoveryCode)),
              isNull(mfaRecoveryCodes.usedAt),
            ),
          )
          .returning({ id: mfaRecoveryCodes.id });
        ok = used.length === 1;
      }

      if (!ok) {
        const failed = user.failedLoginCount + 1;
        const lock = failed >= security.maxFailedLogins;
        await db
          .update(users)
          .set({ failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + security.lockoutMinutes * 60_000) : null })
          .where(eq(users.id, user.id));
        if (lock) {
          await revokeSession(db, req.auth.session.id, "mfa_lockout");
          reply.clearCookie(cookieName, { path: "/" });
        }
        await audit(req, "auth.mfa.verify", { outcome: "failure" });
        throw badRequest("Código inválido.");
      }
      await db.update(users).set({ failedLoginCount: 0 }).where(eq(users.id, user.id));
      await elevateSession(req, reply, user);
      await audit(req, "auth.mfa.verify", { metadata: { method: body.code ? "totp" : "recovery_code" } });
      return { ok: true };
    },
  );

  app.post("/api/auth/mfa/recovery-codes", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req) => {
    const me = currentUser(req);
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
    const user = await loadUser(me.id);
    if (!user.mfaSecretEnc) throw badRequest("A verificação em duas etapas não está ativa.");
    const step = verifyTotp(code, secrets.decrypt(user.mfaSecretEnc), user.mfaLastStep);
    if (step === null) throw badRequest("Código inválido.");
    const codes = generateRecoveryCodes();
    await db.transaction(async (tx) => {
      await tx.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
      await tx.insert(mfaRecoveryCodes).values(codes.map((c) => ({ userId: user.id, codeHash: hashRecoveryCode(c) })));
    });
    await audit(req, "auth.mfa.recovery_codes_regenerated");
    return { recoveryCodes: codes };
  });

  // -------------------------------------------------------------------------
  // Convite (primeiro acesso)
  // -------------------------------------------------------------------------
  app.get("/api/auth/invite/:token", { config: { public: true, allowPartial: true, rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.params);
    const row = await findValidToken(db, token, "invite");
    if (!row) throw notFound("Convite inválido, expirado ou já utilizado. Peça um novo convite ao administrador.");
    const [user] = await db.select().from(users).where(eq(users.id, row.userId));
    if (!user || user.status !== "invited") throw notFound("Convite inválido, expirado ou já utilizado.");
    const security = await settings.get("security");
    return {
      name: user.name,
      email: user.email,
      requiresMfa: MFA_REQUIRED_ROLES.includes(user.role),
      passwordMinLength: security.passwordMinLength,
    };
  });

  app.post(
    "/api/auth/invite/accept",
    { config: { public: true, allowPartial: true, rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = parse(z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) }), req.body);
      const row = await findValidToken(db, body.token, "invite");
      if (!row) throw notFound("Convite inválido, expirado ou já utilizado.");
      const [user] = await db.select().from(users).where(eq(users.id, row.userId));
      if (!user || user.status !== "invited") throw notFound("Convite inválido, expirado ou já utilizado.");
      const security = await settings.get("security");
      const problems = passwordProblems(body.password, { minLength: security.passwordMinLength, name: user.name, email: user.email });
      if (problems.length) throw badRequest(problems[0]!, problems.map((message) => ({ path: "password", message })));
      if (!(await consumeToken(db, row.id))) throw notFound("Convite já utilizado.");
      const hash = await hashPassword(body.password);
      const [activated] = await db
        .update(users)
        .set({ passwordHash: hash, passwordChangedAt: new Date(), status: "active", failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      await db.insert(passwordHistory).values({ userId: user.id, hash });
      await audit(req, "auth.invite.accepted", { actorId: user.id, actorEmail: user.email });
      return loginResponse(req, reply, activated!);
    },
  );

  // -------------------------------------------------------------------------
  // Recuperação de acesso
  // -------------------------------------------------------------------------
  app.post(
    "/api/auth/password/forgot",
    { config: { public: true, allowPartial: true, rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req) => {
      const { email } = parse(z.object({ email: emailSchema }), req.body);
      const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      if (user && user.status === "active") {
        // Limita a 3 pedidos por hora por conta.
        const [recent] = await db
          .select({ n: count() })
          .from(authTokens)
          .where(and(eq(authTokens.userId, user.id), eq(authTokens.type, "password_reset"), gt(authTokens.createdAt, new Date(Date.now() - 3_600_000))));
        const n = Number(recent?.n ?? 0);
        if (n < 3) {
          const security = await settings.get("security");
          const branding = await settings.get("branding");
          const token = await issueAuthToken(db, { userId: user.id, type: "password_reset", ttlMinutes: security.resetExpiryMinutes });
          const msg = resetEmail({
            name: user.name,
            link: `${config.appOrigin}/redefinir-senha/${token}`,
            platform: branding.platformName,
            expiresMinutes: security.resetExpiryMinutes,
          });
          await mailer.send({ to: user.email, ...msg });
        }
        await audit(req, "auth.password.reset_requested", { actorId: user.id, actorEmail: user.email, metadata: { throttled: n >= 3 } });
      } else {
        await audit(req, "auth.password.reset_requested", { outcome: "failure", actorEmail: email, metadata: { reason: "no_active_account" } });
      }
      return { ok: true, message: "Se o e-mail estiver cadastrado e ativo, você receberá as instruções em instantes." };
    },
  );

  app.get("/api/auth/password/reset/:token", { config: { public: true, allowPartial: true, rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.params);
    const row = await findValidToken(db, token, "password_reset");
    const security = await settings.get("security");
    return { valid: !!row, passwordMinLength: security.passwordMinLength };
  });

  async function assertNotReused(userId: string, password: string) {
    const history = await db.select().from(passwordHistory).where(eq(passwordHistory.userId, userId)).orderBy(desc(passwordHistory.createdAt)).limit(5);
    for (const h of history) {
      if (await verifyPassword(h.hash, password)) throw badRequest("Esta senha já foi utilizada. Escolha uma senha nova.");
    }
  }

  app.post(
    "/api/auth/password/reset",
    { config: { public: true, allowPartial: true, rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = parse(z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(200) }), req.body);
      const row = await findValidToken(db, body.token, "password_reset");
      if (!row) throw notFound("Link inválido ou expirado. Solicite uma nova redefinição.");
      const [user] = await db.select().from(users).where(eq(users.id, row.userId));
      if (!user || user.status !== "active") throw notFound("Link inválido ou expirado.");
      const security = await settings.get("security");
      const problems = passwordProblems(body.password, { minLength: security.passwordMinLength, name: user.name, email: user.email });
      if (problems.length) throw badRequest(problems[0]!, problems.map((message) => ({ path: "password", message })));
      await assertNotReused(user.id, body.password);
      if (!(await consumeToken(db, row.id))) throw notFound("Link já utilizado.");
      const hash = await hashPassword(body.password);
      await db.update(users).set({ passwordHash: hash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
      await db.insert(passwordHistory).values({ userId: user.id, hash });
      const revoked = await revokeUserSessions(db, user.id, "password_reset");
      reply.clearCookie(cookieName, { path: "/" });
      await audit(req, "auth.password.reset", { actorId: user.id, actorEmail: user.email, metadata: { sessionsRevoked: revoked } });
      return { ok: true };
    },
  );

  app.post("/api/auth/password/change", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const me = currentUser(req);
    const body = parse(z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) }), req.body);
    const user = await loadUser(me.id);
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      await audit(req, "auth.password.change", { outcome: "failure" });
      throw badRequest("Senha atual incorreta.");
    }
    const security = await settings.get("security");
    const problems = passwordProblems(body.newPassword, { minLength: security.passwordMinLength, name: user.name, email: user.email });
    if (problems.length) throw badRequest(problems[0]!, problems.map((message) => ({ path: "newPassword", message })));
    await assertNotReused(user.id, body.newPassword);
    const hash = await hashPassword(body.newPassword);
    await db.update(users).set({ passwordHash: hash, passwordChangedAt: new Date() }).where(eq(users.id, user.id));
    await db.insert(passwordHistory).values({ userId: user.id, hash });
    const revoked = await revokeUserSessions(db, user.id, "password_changed", req.auth!.session.id);
    await audit(req, "auth.password.change", { metadata: { otherSessionsRevoked: revoked } });
    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Sessões do próprio usuário
  // -------------------------------------------------------------------------
  app.get("/api/auth/sessions", async (req) => {
    const me = currentUser(req);
    const rows = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, me.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()), gt(sessions.idleExpiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    return rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      ip: s.ip,
      userAgent: s.userAgent,
      current: s.id === req.auth!.session.id,
    }));
  });

  app.delete("/api/auth/sessions/:id", async (req) => {
    const me = currentUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [s] = await db.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, me.id)));
    if (!s) throw notFound();
    await revokeSession(db, id, "user_revoked");
    await audit(req, "auth.session.revoked", { targetType: "session", targetId: id });
    return { ok: true };
  });
}
