import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, ilike, isNull, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ROLES, USER_STATUS, userCode } from "../../../shared/domain.js";
import { issueAuthToken, invalidateUserTokens } from "../../auth/tokens.js";
import { revokeSession, revokeUserSessions } from "../../auth/sessions.js";
import {
  bookmarks,
  comments,
  departments,
  enrollments,
  highlights,
  jobTitles,
  knowledgeAreas,
  leaderAreas,
  mfaRecoveryCodes,
  notes,
  notifications,
  sessions,
  teamLeaders,
  teams,
  tracks,
  users,
} from "../../db/schema.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit, requireRole } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";
import { inviteEmail, resetEmail } from "../../services/emails.js";

const idParams = z.object({ id: z.string().uuid() });
const optionalUuid = z.string().uuid().nullable().optional();

export async function adminUserRoutes(app: FastifyInstance) {
  const { db, settings, mailer, config } = app.ctx;

  async function sendInvite(userId: string, createdBy: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw notFound();
    const security = await settings.get("security");
    const branding = await settings.get("branding");
    const token = await issueAuthToken(db, { userId, type: "invite", ttlMinutes: security.inviteExpiryHours * 60, createdBy });
    const link = `${config.appOrigin}/convite/${token}`;
    const msg = inviteEmail({ name: user.name, link, platform: branding.platformName, organization: branding.organizationName, expiresHours: security.inviteExpiryHours });
    await mailer.send({ to: user.email, ...msg });
    // Sem SMTP configurado, o administrador recebe o link para enviar por um canal seguro.
    return { emailed: mailer.configured, inviteLink: mailer.configured ? null : link, expiresHours: security.inviteExpiryHours };
  }

  async function assertNotLastAdmin(userId: string) {
    const [row] = await db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, userId)));
    if (Number(row?.n ?? 0) === 0) throw badRequest("É preciso manter pelo menos um administrador ativo.");
  }

  app.get("/api/admin/users", async (req) => {
    requireRole(req, "admin");
    const q = parse(
      z.object({
        q: z.string().max(100).optional(),
        role: z.enum(ROLES).optional(),
        status: z.enum(USER_STATUS).optional(),
        teamId: z.string().uuid().optional(),
        departmentId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const conds = [isNull(users.anonymizedAt)];
    if (q.q?.trim()) {
      const term = `%${q.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(users.name, term), ilike(users.email, term))!);
    }
    if (q.role) conds.push(eq(users.role, q.role));
    if (q.status) conds.push(eq(users.status, q.status));
    if (q.teamId) conds.push(eq(users.teamId, q.teamId));
    if (q.departmentId) conds.push(eq(users.departmentId, q.departmentId));
    const rows = await db
      .select({ u: users, jobTitle: jobTitles.name, team: teams.name, department: departments.name })
      .from(users)
      .leftJoin(jobTitles, eq(jobTitles.id, users.jobTitleId))
      .leftJoin(teams, eq(teams.id, users.teamId))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(and(...conds))
      .orderBy(asc(users.name))
      .limit(1000);
    return rows.map(({ u, jobTitle, team, department }) => ({
      id: u.id,
      code: userCode(u.seq),
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      jobTitle,
      team,
      department,
      mfaEnabled: u.mfaEnabled,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil && u.lockedUntil.getTime() > Date.now() ? u.lockedUntil : null,
      createdAt: u.createdAt,
    }));
  });

  const userBody = z.object({
    name: z.string().trim().min(3, "Informe o nome completo.").max(150),
    email: z.string().trim().toLowerCase().email("E-mail inválido.").max(254),
    role: z.enum(ROLES).default("collaborator"),
    jobTitleId: optionalUuid,
    departmentId: optionalUuid,
    teamId: optionalUuid,
  });

  app.post("/api/admin/users", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
    const admin = requireRole(req, "admin");
    const body = parse(userBody, req.body);
    const [exists] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${body.email}`);
    if (exists) throw conflict("Já existe um usuário com este e-mail.");
    const [user] = await db
      .insert(users)
      .values({
        name: body.name,
        email: body.email,
        role: body.role,
        jobTitleId: body.jobTitleId ?? null,
        departmentId: body.departmentId ?? null,
        teamId: body.teamId ?? null,
        status: "invited",
        createdBy: admin.id,
      })
      .returning();
    const invite = await sendInvite(user!.id, admin.id);
    await audit(req, "user.created", { targetType: "user", targetId: user!.id, metadata: { email: body.email, role: body.role } });
    return { id: user!.id, code: userCode(user!.seq), ...invite };
  });

  app.get("/api/admin/users/:id", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound("Usuário não encontrado.");
    const areas = await db
      .select({ areaId: leaderAreas.areaId, name: knowledgeAreas.name, canEdit: leaderAreas.canEdit, canPublish: leaderAreas.canPublish })
      .from(leaderAreas)
      .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, leaderAreas.areaId))
      .where(eq(leaderAreas.userId, id));
    const led = await db.select({ teamId: teamLeaders.teamId, name: teams.name }).from(teamLeaders).innerJoin(teams, eq(teams.id, teamLeaders.teamId)).where(eq(teamLeaders.userId, id));
    const activeSessions = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()), gt(sessions.idleExpiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt));
    const enr = await db
      .select({ e: enrollments, title: tracks.title })
      .from(enrollments)
      .innerJoin(tracks, eq(tracks.id, enrollments.trackId))
      .where(eq(enrollments.userId, id))
      .orderBy(desc(enrollments.updatedAt));
    return {
      user: {
        id: u.id,
        code: userCode(u.seq),
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        jobTitleId: u.jobTitleId,
        departmentId: u.departmentId,
        teamId: u.teamId,
        mfaEnabled: u.mfaEnabled,
        lastLoginAt: u.lastLoginAt,
        lockedUntil: u.lockedUntil && u.lockedUntil.getTime() > Date.now() ? u.lockedUntil : null,
        onboardingCompletedAt: u.onboardingCompletedAt,
        createdAt: u.createdAt,
        deactivatedAt: u.deactivatedAt,
      },
      leaderAreas: areas,
      leaderTeams: led,
      sessions: activeSessions.map((s) => ({ id: s.id, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, ip: s.ip, userAgent: s.userAgent, mfa: !!s.mfaVerifiedAt })),
      enrollments: enr.map(({ e, title }) => ({ id: e.id, trackId: e.trackId, title, status: e.status, percent: e.progressPercent, source: e.source, dueDate: e.dueDate, isMandatory: e.isMandatory })),
    };
  });

  app.patch("/api/admin/users/:id", async (req) => {
    const admin = requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const body = parse(userBody.partial().omit({ email: true }), req.body);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound();
    if (body.role && body.role !== u.role && u.role === "admin") await assertNotLastAdmin(id);
    await db
      .update(users)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.role ? { role: body.role } : {}),
        ...(body.jobTitleId !== undefined ? { jobTitleId: body.jobTitleId } : {}),
        ...(body.departmentId !== undefined ? { departmentId: body.departmentId } : {}),
        ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    // Mudança de perfil invalida as sessões: o novo nível de acesso (e o MFA, se exigido) vale no próximo login.
    if (body.role && body.role !== u.role) {
      await revokeUserSessions(db, id, "role_changed");
      if (body.role === "collaborator") {
        await db.delete(leaderAreas).where(eq(leaderAreas.userId, id));
        await db.delete(teamLeaders).where(eq(teamLeaders.userId, id));
      }
    }
    await audit(req, "user.updated", { targetType: "user", targetId: id, metadata: { changes: body, by: admin.id, previousRole: u.role } });
    return { ok: true };
  });

  app.put("/api/admin/users/:id/leader-scope", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        areas: z.array(z.object({ areaId: z.string().uuid(), canEdit: z.boolean().default(false), canPublish: z.boolean().default(false) })).max(50),
        teamIds: z.array(z.string().uuid()).max(50),
      }),
      req.body,
    );
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound();
    if (u.role !== "leader") throw badRequest("Defina o perfil como Líder de área antes de configurar o escopo.");
    await db.transaction(async (tx) => {
      await tx.delete(leaderAreas).where(eq(leaderAreas.userId, id));
      if (body.areas.length) {
        await tx.insert(leaderAreas).values(body.areas.map((a) => ({ userId: id, areaId: a.areaId, canEdit: a.canEdit || a.canPublish, canPublish: a.canPublish })));
      }
      await tx.delete(teamLeaders).where(eq(teamLeaders.userId, id));
      if (body.teamIds.length) await tx.insert(teamLeaders).values(body.teamIds.map((teamId) => ({ teamId, userId: id })));
    });
    await audit(req, "user.leader_scope_updated", { targetType: "user", targetId: id, metadata: body });
    return { ok: true };
  });

  app.post("/api/admin/users/:id/invite", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const admin = requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound();
    if (u.status !== "invited") throw badRequest("O usuário já ativou o acesso.");
    const invite = await sendInvite(id, admin.id);
    await audit(req, "user.invite_resent", { targetType: "user", targetId: id });
    return invite;
  });

  /** Link de redefinição de senha gerado pelo administrador (essencial quando não há SMTP configurado). */
  app.post("/api/admin/users/:id/password-reset", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (req) => {
    const admin = requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound();
    if (u.status !== "active") throw badRequest("Disponível apenas para usuários ativos. Para convites pendentes, reenvie o convite.");
    const security = await settings.get("security");
    const branding = await settings.get("branding");
    const token = await issueAuthToken(db, { userId: id, type: "password_reset", ttlMinutes: security.resetExpiryMinutes, createdBy: admin.id });
    const link = `${config.appOrigin}/redefinir-senha/${token}`;
    await mailer.send({ to: u.email, ...resetEmail({ name: u.name, link, platform: branding.platformName, expiresMinutes: security.resetExpiryMinutes }) });
    await audit(req, "user.password_reset_link", { targetType: "user", targetId: id, metadata: { emailed: mailer.configured } });
    return { emailed: mailer.configured, inviteLink: mailer.configured ? null : link, expiresMinutes: security.resetExpiryMinutes };
  });

  app.post("/api/admin/users/:id/deactivate", async (req) => {
    const admin = requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    if (id === admin.id) throw badRequest("Você não pode desativar o próprio usuário.");
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound();
    if (u.role === "admin") await assertNotLastAdmin(id);
    await db.update(users).set({ status: "inactive", deactivatedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, id));
    const revoked = await revokeUserSessions(db, id, "deactivated");
    await invalidateUserTokens(db, id);
    await audit(req, "user.deactivated", { targetType: "user", targetId: id, metadata: { sessionsRevoked: revoked } });
    return { ok: true, sessionsRevoked: revoked };
  });

  app.post("/api/admin/users/:id/reactivate", async (req) => {
    const admin = requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u || u.anonymizedAt) throw notFound();
    const status = u.passwordHash ? "active" : "invited";
    await db.update(users).set({ status, deactivatedAt: null, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(users.id, id));
    const invite = status === "invited" ? await sendInvite(id, admin.id) : null;
    await audit(req, "user.reactivated", { targetType: "user", targetId: id });
    return { ok: true, status, invite };
  });

  app.post("/api/admin/users/:id/reset-mfa", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    await db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null }).where(eq(users.id, id));
    await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, id));
    const revoked = await revokeUserSessions(db, id, "mfa_reset");
    await audit(req, "user.mfa_reset", { targetType: "user", targetId: id, metadata: { sessionsRevoked: revoked } });
    return { ok: true };
  });

  app.post("/api/admin/users/:id/unlock", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, id));
    await audit(req, "user.unlocked", { targetType: "user", targetId: id });
    return { ok: true };
  });

  app.post("/api/admin/users/:id/revoke-sessions", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const n = await revokeUserSessions(db, id, "admin_revoked");
    await audit(req, "user.sessions_revoked", { targetType: "user", targetId: id, metadata: { count: n } });
    return { ok: true, revoked: n };
  });

  /** Anonimização (LGPD): remove dados pessoais de um usuário desativado, mantendo registros agregados. */
  app.post("/api/admin/users/:id/anonymize", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    const { confirm } = parse(z.object({ confirm: z.literal("ANONIMIZAR") }), req.body);
    void confirm;
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) throw notFound();
    if (u.status !== "inactive") throw badRequest("Desative o usuário antes de anonimizar.");
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          name: `Usuário removido ${userCode(u.seq)}`,
          email: `removido-${randomBytes(8).toString("hex")}@anonimo.invalid`,
          passwordHash: null,
          mfaSecretEnc: null,
          mfaPendingSecretEnc: null,
          mfaEnabled: false,
          preferences: {},
          anonymizedAt: new Date(),
        })
        .where(eq(users.id, id));
      await tx.delete(notes).where(eq(notes.userId, id));
      await tx.delete(highlights).where(eq(highlights.userId, id));
      await tx.delete(bookmarks).where(eq(bookmarks.userId, id));
      await tx.delete(notifications).where(eq(notifications.userId, id));
      await tx.update(comments).set({ body: "[comentário removido]", isHidden: true }).where(eq(comments.userId, id));
      await tx.delete(sessions).where(eq(sessions.userId, id));
    });
    await audit(req, "user.anonymized", { targetType: "user", targetId: id });
    return { ok: true };
  });

  app.delete("/api/admin/sessions/:id", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(idParams, req.params);
    await revokeSession(db, id, "admin_revoked");
    await audit(req, "session.revoked", { targetType: "session", targetId: id });
    return { ok: true };
  });

  app.get("/api/admin/sessions", async (req) => {
    requireRole(req, "admin");
    const rows = await db
      .select({ s: sessions, name: users.name, email: users.email, role: users.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()), gt(sessions.idleExpiresAt, new Date())))
      .orderBy(desc(sessions.lastSeenAt))
      .limit(500);
    return rows.map(({ s, name, email, role }) => ({
      id: s.id,
      userId: s.userId,
      name,
      email,
      role,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      ip: s.ip,
      userAgent: s.userAgent,
      mfa: !!s.mfaVerifiedAt,
    }));
  });

  // ------------------------------------------------------------------ Organização
  const nameBody = z.object({ name: z.string().trim().min(2).max(120), departmentId: optionalUuid });

  app.get("/api/admin/org", async (req) => {
    requireRole(req, "leader", "admin");
    const [deps, tms, jts, leaders] = await Promise.all([
      db.select().from(departments).orderBy(asc(departments.name)),
      db.select().from(teams).orderBy(asc(teams.name)),
      db.select().from(jobTitles).orderBy(asc(jobTitles.name)),
      db.select({ teamId: teamLeaders.teamId, userId: teamLeaders.userId, name: users.name }).from(teamLeaders).innerJoin(users, eq(users.id, teamLeaders.userId)),
    ]);
    const memberCounts = await db.select({ teamId: users.teamId, n: count() }).from(users).where(eq(users.status, "active")).groupBy(users.teamId);
    return {
      departments: deps,
      teams: tms.map((t) => ({
        ...t,
        leaders: leaders.filter((l) => l.teamId === t.id).map((l) => ({ id: l.userId, name: l.name })),
        members: Number(memberCounts.find((m) => m.teamId === t.id)?.n ?? 0),
      })),
      jobTitles: jts,
    };
  });

  for (const [path, table] of [
    ["departments", departments],
    ["teams", teams],
    ["job-titles", jobTitles],
  ] as const) {
    app.post(`/api/admin/${path}`, async (req) => {
      requireRole(req, "admin");
      const body = parse(nameBody, req.body);
      try {
        const values = path === "departments" ? { name: body.name } : { name: body.name, departmentId: body.departmentId ?? null };
        const [row] = await db.insert(table).values(values as never).returning();
        await audit(req, `org.${path}.created`, { targetId: (row as { id: string }).id, metadata: { name: body.name } });
        return row;
      } catch {
        throw conflict("Já existe um item com este nome.");
      }
    });
    app.patch(`/api/admin/${path}/:id`, async (req) => {
      requireRole(req, "admin");
      const { id } = parse(idParams, req.params);
      const body = parse(nameBody.partial(), req.body);
      const values = path === "departments" ? { name: body.name } : { name: body.name, departmentId: body.departmentId };
      await db.update(table).set(values as never).where(eq(table.id, id));
      await audit(req, `org.${path}.updated`, { targetId: id, metadata: body });
      return { ok: true };
    });
    app.delete(`/api/admin/${path}/:id`, async (req) => {
      requireRole(req, "admin");
      const { id } = parse(idParams, req.params);
      await db.delete(table).where(eq(table.id, id));
      await audit(req, `org.${path}.deleted`, { targetId: id });
      return { ok: true };
    });
  }

  /** Lista enxuta para seletores (líderes veem só a própria equipe). */
  app.get("/api/admin/users-lite", async (req) => {
    const me = requireRole(req, "leader", "admin");
    const rows = await db
      .select({ id: users.id, name: users.name, role: users.role, teamId: users.teamId, status: users.status })
      .from(users)
      .where(and(eq(users.status, "active"), isNull(users.anonymizedAt)))
      .orderBy(asc(users.name));
    if (me.role === "admin") return rows;
    const led = (await db.select({ teamId: teamLeaders.teamId }).from(teamLeaders).where(eq(teamLeaders.userId, me.id))).map((r) => r.teamId);
    return rows.filter((r) => r.teamId && led.includes(r.teamId) && r.role !== "admin" && r.id !== me.id);
  });

}
