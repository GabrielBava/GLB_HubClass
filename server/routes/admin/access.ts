import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ACCESS_RESOURCES, ACCESS_SUBJECTS, ROLES, type AccessResource, type AccessSubject } from "../../../shared/domain.js";
import type { AuthUser } from "../../auth/sessions.js";
import { AccessEvaluator, loadContentChain, loadModuleChain, loadTrackChain, type ChainNode } from "../../authz/policy.js";
import {
  accessRules,
  contents,
  departments,
  enrollments,
  jobTitles,
  knowledgeAreas,
  modules,
  teams,
  tracks,
  users,
} from "../../db/schema.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { audit, requireRole } from "../../lib/http.js";
import { parse } from "../../lib/validate.js";
import { evaluateTrackAccess, loadCatalogIndex } from "../../services/catalog.js";
import { notify } from "../../services/notifications.js";
import { refreshEnrollment } from "../../services/progress.js";

const REASON_LABEL: Record<string, string> = {
  admin: "Administrador acessa tudo",
  leader_area: "Líder responsável pela área",
  free: "Trilha livre para todos os usuários ativos",
  enrolled: "Trilha atribuída ao usuário",
  rule: "Regra de permissão",
  denied_rule: "Bloqueado por regra de negação",
  unpublished: "Conteúdo não publicado",
  no_rule: "Sem regra de permissão (negado por padrão)",
};

export async function adminAccessRoutes(app: FastifyInstance) {
  const { db, settings } = app.ctx;

  async function subjectName(type: AccessSubject, id: string | null) {
    if (type === "everyone") return "Todos os usuários ativos";
    if (!id) return "";
    if (type === "role") return ROLES.includes(id as never) ? id : "";
    const table = { user: users, team: teams, department: departments, job_title: jobTitles }[type];
    const [row] = await db.select({ name: table.name }).from(table).where(eq(table.id, id));
    return row?.name ?? "(removido)";
  }

  async function resourceName(type: AccessResource, id: string) {
    const table = { area: knowledgeAreas, track: tracks, module: modules, content: contents }[type];
    const col = type === "area" ? knowledgeAreas.name : (table as typeof tracks).title;
    const [row] = await db.select({ name: col }).from(table).where(eq(table.id, id));
    return row?.name ?? "(removido)";
  }

  app.get("/api/admin/access-rules", async (req) => {
    requireRole(req, "admin");
    const q = parse(
      z.object({
        resourceType: z.enum(ACCESS_RESOURCES).optional(),
        resourceId: z.string().uuid().optional(),
        subjectType: z.enum(ACCESS_SUBJECTS).optional(),
        subjectId: z.string().max(60).optional(),
      }),
      req.query,
    );
    const conds = [];
    if (q.resourceType) conds.push(eq(accessRules.resourceType, q.resourceType));
    if (q.resourceId) conds.push(eq(accessRules.resourceId, q.resourceId));
    if (q.subjectType) conds.push(eq(accessRules.subjectType, q.subjectType));
    if (q.subjectId) conds.push(eq(accessRules.subjectId, q.subjectId));
    const rows = await db
      .select({ r: accessRules, grantedByName: users.name })
      .from(accessRules)
      .leftJoin(users, eq(users.id, accessRules.grantedBy))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(accessRules.createdAt))
      .limit(1000);
    const out = [];
    for (const { r, grantedByName } of rows) {
      out.push({
        ...r,
        subjectName: await subjectName(r.subjectType, r.subjectId),
        resourceName: await resourceName(r.resourceType, r.resourceId),
        grantedByName,
        expired: !!r.expiresAt && r.expiresAt.getTime() < Date.now(),
      });
    }
    return out;
  });

  app.post("/api/admin/access-rules", async (req) => {
    const admin = requireRole(req, "admin");
    const body = parse(
      z.object({
        subjectType: z.enum(ACCESS_SUBJECTS),
        subjectId: z.string().max(60).nullable().optional(),
        resourceType: z.enum(ACCESS_RESOURCES),
        resourceId: z.string().uuid(),
        effect: z.enum(["allow", "deny"]).default("allow"),
        note: z.string().trim().max(500).default(""),
        expiresAt: z.string().date().nullable().optional(),
      }),
      req.body,
    );
    if (body.subjectType !== "everyone" && !body.subjectId) throw badRequest("Escolha a quem a regra se aplica.");
    if (body.subjectType === "role" && !ROLES.includes(body.subjectId as never)) throw badRequest("Perfil inválido.");
    if (["user", "team", "department", "job_title"].includes(body.subjectType) && !z.string().uuid().safeParse(body.subjectId).success) {
      throw badRequest("Identificador inválido.");
    }
    if ((await resourceName(body.resourceType, body.resourceId)) === "(removido)") throw notFound("Recurso não encontrado.");
    const [rule] = await db
      .insert(accessRules)
      .values({
        subjectType: body.subjectType,
        subjectId: body.subjectType === "everyone" ? null : body.subjectId!,
        resourceType: body.resourceType,
        resourceId: body.resourceId,
        effect: body.effect,
        note: body.note,
        grantedBy: admin.id,
        expiresAt: body.expiresAt ? new Date(`${body.expiresAt}T23:59:59-03:00`) : null,
      })
      .returning();
    await audit(req, "access.rule_created", { targetType: "access_rule", targetId: rule!.id, metadata: body });
    return rule;
  });

  app.delete("/api/admin/access-rules/:id", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const [rule] = await db.delete(accessRules).where(eq(accessRules.id, id)).returning();
    if (!rule) throw notFound();
    await audit(req, "access.rule_deleted", { targetType: "access_rule", targetId: id, metadata: { ...rule } });
    return { ok: true };
  });

  async function authUser(userId: string): Promise<AuthUser> {
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound("Usuário não encontrado.");
    return {
      id: u.id,
      seq: u.seq,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      teamId: u.teamId,
      departmentId: u.departmentId,
      jobTitleId: u.jobTitleId,
      mfaEnabled: u.mfaEnabled,
      onboardingCompletedAt: u.onboardingCompletedAt,
    };
  }

  async function chainFor(type: AccessResource, id: string): Promise<ChainNode | null> {
    if (type === "track") return (await loadTrackChain(db, id))?.chain ?? null;
    if (type === "module") return (await loadModuleChain(db, id))?.chain ?? null;
    if (type === "content") return (await loadContentChain(db, id))?.chain ?? null;
    const [a] = await db.select().from(knowledgeAreas).where(eq(knowledgeAreas.id, id));
    return a ? { area: { id: a.id, isVisible: a.isVisible } } : null;
  }

  /** Explica por que um usuário tem (ou não) acesso a um recurso. */
  app.get("/api/admin/access/check", async (req) => {
    requireRole(req, "admin");
    const q = parse(z.object({ userId: z.string().uuid(), resourceType: z.enum(ACCESS_RESOURCES), resourceId: z.string().uuid() }), req.query);
    const user = await authUser(q.userId);
    const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, q.userId));
    const chain = await chainFor(q.resourceType, q.resourceId);
    if (!chain) throw notFound("Recurso não encontrado.");
    const ev = await AccessEvaluator.forUser(db, user);
    const d = ev.decide(chain);
    const active = u?.status === "active";
    return {
      allowed: active && d.allowed,
      reason: active ? d.reason : "inactive",
      explanation: active ? REASON_LABEL[d.reason] : "Usuário não está ativo: nenhum acesso é concedido.",
    };
  });

  /** O que um usuário pode acessar (por trilha). */
  app.get("/api/admin/access/user/:id", async (req) => {
    requireRole(req, "admin");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const user = await authUser(id);
    const ev = await AccessEvaluator.forUser(db, user);
    const index = await loadCatalogIndex(db, await settings.get("reading"));
    return index.tracks
      .map((t) => {
        const area = index.areaById.get(t.areaId)!;
        const r = evaluateTrackAccess(ev, area, t, index.modulesByTrack.get(t.id) ?? [], (m) => index.contentsByModule.get(m) ?? []);
        return { trackId: t.id, title: t.title, areaName: area.name, status: t.status, access: r.access, reason: r.reason, explanation: REASON_LABEL[r.reason] ?? r.reason };
      })
      .sort((a, b) => a.areaName.localeCompare(b.areaName) || a.title.localeCompare(b.title));
  });

  /** Quem pode acessar um recurso (usuários ativos). */
  app.get("/api/admin/access/resource", async (req) => {
    requireRole(req, "admin");
    const q = parse(z.object({ resourceType: z.enum(ACCESS_RESOURCES), resourceId: z.string().uuid() }), req.query);
    const chain = await chainFor(q.resourceType, q.resourceId);
    if (!chain) throw notFound("Recurso não encontrado.");
    const active = await db.select().from(users).where(eq(users.status, "active")).orderBy(asc(users.name));
    const out = [];
    for (const u of active) {
      const ev = await AccessEvaluator.forUser(db, {
        id: u.id,
        seq: u.seq,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        teamId: u.teamId,
        departmentId: u.departmentId,
        jobTitleId: u.jobTitleId,
        mfaEnabled: u.mfaEnabled,
        onboardingCompletedAt: u.onboardingCompletedAt,
      });
      const d = ev.decide(chain);
      if (d.allowed) out.push({ id: u.id, name: u.name, role: u.role, reason: d.reason, explanation: REASON_LABEL[d.reason] });
    }
    return out;
  });

  /** Atribuição em massa (ex.: trilha obrigatória para um cargo, equipe ou departamento). */
  app.post("/api/admin/assignments/bulk", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const admin = requireRole(req, "admin");
    const body = parse(
      z.object({
        trackId: z.string().uuid(),
        subjectType: z.enum(["team", "department", "job_title", "role", "everyone"]),
        subjectId: z.string().max(60).nullable().optional(),
        dueDate: z.string().date().nullable().optional(),
        isMandatory: z.boolean().default(true),
      }),
      req.body,
    );
    const [track] = await db.select().from(tracks).where(eq(tracks.id, body.trackId));
    if (!track || track.status !== "published") throw notFound("Trilha não encontrada ou não publicada.");
    const field = { team: users.teamId, department: users.departmentId, job_title: users.jobTitleId, role: users.role, everyone: null }[body.subjectType];
    const conds = [eq(users.status, "active")];
    if (field) conds.push(eq(field as typeof users.teamId, body.subjectId as string));
    const targets = await db.select({ id: users.id }).from(users).where(and(...conds));
    const due = body.dueDate ? new Date(`${body.dueDate}T23:59:59-03:00`) : null;
    for (const t of targets) {
      await db
        .insert(enrollments)
        .values({ userId: t.id, trackId: track.id, source: "admin", assignedBy: admin.id, isMandatory: body.isMandatory, dueDate: due })
        .onConflictDoUpdate({
          target: [enrollments.userId, enrollments.trackId],
          set: { source: "admin", assignedBy: admin.id, isMandatory: body.isMandatory, dueDate: due, updatedAt: new Date() },
        });
      await refreshEnrollment(app.ctx, t.id, track.id);
      await notify(app.ctx, {
        userId: t.id,
        type: "track_assigned",
        title: "Nova trilha atribuída",
        body: `A trilha “${track.title}” foi atribuída a você${due ? ` com prazo até ${due.toLocaleDateString("pt-BR")}` : ""}.`,
        link: `/trilhas/${track.id}`,
        dedupeKey: `assign:${track.id}:${body.dueDate ?? "sem-prazo"}`,
      });
    }
    await audit(req, "assignment.bulk_created", { targetType: "track", targetId: track.id, metadata: { ...body, users: targets.length } });
    return { ok: true, assigned: targets.length };
  });

}
