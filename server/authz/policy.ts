import { and, eq, gt, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import type { AccessResource, Role } from "../../shared/domain.js";
import type { AuthUser } from "../auth/sessions.js";
import type { DB } from "../db/client.js";
import { accessRules, contents, enrollments, knowledgeAreas, leaderAreas, modules, teamLeaders, tracks, users } from "../db/schema.js";
import { forbidden, notFound } from "../lib/errors.js";

/**
 * Política central de autorização (RBAC + regras contextuais).
 *
 * Regras, em ordem:
 *  1. Administrador acessa tudo (inclusive rascunhos, para pré-visualização).
 *  2. Conteúdo precisa estar publicado em toda a cadeia (área visível, trilha, módulo, conteúdo).
 *     Líder com permissão de edição na área pode pré-visualizar rascunhos da própria área.
 *  3. Uma regra "negar" que alcance o usuário em qualquer nível da cadeia bloqueia o acesso.
 *  4. Líder acessa as trilhas das áreas pelas quais responde.
 *  5. Trilha "livre" é aberta a todos os usuários ativos.
 *  6. Matrícula/atribuição na trilha libera a trilha.
 *  7. Regra "permitir" em qualquer nível da cadeia (área, trilha, módulo ou conteúdo) libera.
 *  8. Caso contrário, nega (negar por padrão).
 */

export interface UserScope {
  id: string;
  role: Role;
  teamId: string | null;
  departmentId: string | null;
  jobTitleId: string | null;
  leaderAreaIds: Set<string>;
  leaderEditAreaIds: Set<string>;
  leaderPublishAreaIds: Set<string>;
  leaderTeamIds: Set<string>;
}

export async function loadScope(db: DB, user: AuthUser): Promise<UserScope> {
  const scope: UserScope = {
    id: user.id,
    role: user.role,
    teamId: user.teamId,
    departmentId: user.departmentId,
    jobTitleId: user.jobTitleId,
    leaderAreaIds: new Set(),
    leaderEditAreaIds: new Set(),
    leaderPublishAreaIds: new Set(),
    leaderTeamIds: new Set(),
  };
  if (user.role === "leader") {
    const areas = await db.select().from(leaderAreas).where(eq(leaderAreas.userId, user.id));
    for (const a of areas) {
      scope.leaderAreaIds.add(a.areaId);
      if (a.canEdit) scope.leaderEditAreaIds.add(a.areaId);
      if (a.canPublish) scope.leaderPublishAreaIds.add(a.areaId);
    }
    const ts = await db.select().from(teamLeaders).where(eq(teamLeaders.userId, user.id));
    for (const t of ts) scope.leaderTeamIds.add(t.teamId);
  }
  return scope;
}

export type Rule = typeof accessRules.$inferSelect;

/** Regras que alcançam o usuário (por ele mesmo, equipe, departamento, cargo, perfil ou "todos"). */
export async function loadUserRules(db: DB, scope: Pick<UserScope, "id" | "role" | "teamId" | "departmentId" | "jobTitleId">): Promise<Rule[]> {
  const subjects: SQL[] = [
    and(eq(accessRules.subjectType, "user"), eq(accessRules.subjectId, scope.id))!,
    and(eq(accessRules.subjectType, "role"), eq(accessRules.subjectId, scope.role))!,
    eq(accessRules.subjectType, "everyone"),
  ];
  if (scope.teamId) subjects.push(and(eq(accessRules.subjectType, "team"), eq(accessRules.subjectId, scope.teamId))!);
  if (scope.departmentId) subjects.push(and(eq(accessRules.subjectType, "department"), eq(accessRules.subjectId, scope.departmentId))!);
  if (scope.jobTitleId) subjects.push(and(eq(accessRules.subjectType, "job_title"), eq(accessRules.subjectId, scope.jobTitleId))!);
  return db
    .select()
    .from(accessRules)
    .where(and(or(...subjects), or(isNull(accessRules.expiresAt), gt(accessRules.expiresAt, new Date()))));
}

/**
 * Trilhas atribuídas ao usuário (por administrador, líder ou regra). Matrículas criadas pelo
 * próprio colaborador ("self") só registram progresso e nunca concedem acesso.
 */
export async function loadEnrolledTrackIds(db: DB, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ trackId: enrollments.trackId })
    .from(enrollments)
    .where(and(eq(enrollments.userId, userId), ne(enrollments.source, "self")));
  return new Set(rows.map((r) => r.trackId));
}

export interface ChainNode {
  area: { id: string; isVisible: boolean };
  track?: { id: string; status: string; mode: string };
  module?: { id: string; status: string };
  content?: { id: string; status: string };
}

export type AccessReason = "admin" | "leader_area" | "leader_preview" | "free" | "enrolled" | "rule" | "denied_rule" | "unpublished" | "no_rule";

export interface AccessDecision {
  allowed: boolean;
  reason: AccessReason;
}

export class AccessEvaluator {
  private allow = new Map<string, boolean>();
  private deny = new Set<string>();

  constructor(
    readonly scope: UserScope,
    rules: Rule[],
    private readonly enrolled: Set<string>,
  ) {
    for (const r of rules) {
      const key = `${r.resourceType}:${r.resourceId}`;
      if (r.effect === "deny") this.deny.add(key);
      else this.allow.set(key, true);
    }
  }

  static async forUser(db: DB, user: AuthUser, scope?: UserScope) {
    const s = scope ?? (await loadScope(db, user));
    const [rules, enrolled] = await Promise.all([loadUserRules(db, s), loadEnrolledTrackIds(db, s.id)]);
    return new AccessEvaluator(s, rules, enrolled);
  }

  private keys(chain: ChainNode): string[] {
    const keys = [`area:${chain.area.id}`];
    if (chain.track) keys.push(`track:${chain.track.id}`);
    if (chain.module) keys.push(`module:${chain.module.id}`);
    if (chain.content) keys.push(`content:${chain.content.id}`);
    return keys;
  }

  isPublished(chain: ChainNode): boolean {
    if (!chain.area.isVisible) return false;
    if (chain.track && chain.track.status !== "published") return false;
    if (chain.module && chain.module.status !== "published") return false;
    if (chain.content && chain.content.status !== "published") return false;
    return true;
  }

  decide(chain: ChainNode): AccessDecision {
    const s = this.scope;
    if (s.role === "admin") return { allowed: true, reason: "admin" };
    if (!this.isPublished(chain)) {
      if (s.role === "leader" && s.leaderEditAreaIds.has(chain.area.id)) return { allowed: true, reason: "leader_preview" };
      return { allowed: false, reason: "unpublished" };
    }
    const keys = this.keys(chain);
    if (keys.some((k) => this.deny.has(k))) return { allowed: false, reason: "denied_rule" };
    if (s.role === "leader" && s.leaderAreaIds.has(chain.area.id)) return { allowed: true, reason: "leader_area" };
    if (chain.track?.mode === "livre") return { allowed: true, reason: "free" };
    if (chain.track && this.enrolled.has(chain.track.id)) return { allowed: true, reason: "enrolled" };
    if (keys.some((k) => this.allow.has(k))) return { allowed: true, reason: "rule" };
    return { allowed: false, reason: "no_rule" };
  }

  /** A trilha está liberada e algum conteúdo/módulo dela (ou ela inteira) também? */
  isEnrolled(trackId: string) {
    return this.enrolled.has(trackId);
  }

  /** Há regra de permissão específica para um módulo ou conteúdo (sem liberar a trilha toda)? */
  hasGranularAllow(resource: AccessResource, id: string) {
    return this.allow.has(`${resource}:${id}`);
  }
}

// ---------------------------------------------------------------------------
// Carregamento de cadeias a partir de identificadores (evita IDOR: o servidor
// sempre resolve a hierarquia real do recurso pedido, nunca confia no cliente).
// ---------------------------------------------------------------------------

export async function loadTrackChain(db: DB, trackId: string) {
  const [row] = await db
    .select({ track: tracks, area: knowledgeAreas })
    .from(tracks)
    .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
    .where(eq(tracks.id, trackId))
    .limit(1);
  if (!row) return null;
  const chain: ChainNode = {
    area: { id: row.area.id, isVisible: row.area.isVisible },
    track: { id: row.track.id, status: row.track.status, mode: row.track.mode },
  };
  return { ...row, chain };
}

export async function loadModuleChain(db: DB, moduleId: string) {
  const [row] = await db
    .select({ module: modules, track: tracks, area: knowledgeAreas })
    .from(modules)
    .innerJoin(tracks, eq(tracks.id, modules.trackId))
    .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
    .where(eq(modules.id, moduleId))
    .limit(1);
  if (!row) return null;
  const chain: ChainNode = {
    area: { id: row.area.id, isVisible: row.area.isVisible },
    track: { id: row.track.id, status: row.track.status, mode: row.track.mode },
    module: { id: row.module.id, status: row.module.status },
  };
  return { ...row, chain };
}

export async function loadContentChain(db: DB, contentId: string) {
  const [row] = await db
    .select({ content: contents, module: modules, track: tracks, area: knowledgeAreas })
    .from(contents)
    .innerJoin(modules, eq(modules.id, contents.moduleId))
    .innerJoin(tracks, eq(tracks.id, modules.trackId))
    .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
    .where(eq(contents.id, contentId))
    .limit(1);
  if (!row) return null;
  const chain: ChainNode = {
    area: { id: row.area.id, isVisible: row.area.isVisible },
    track: { id: row.track.id, status: row.track.status, mode: row.track.mode },
    module: { id: row.module.id, status: row.module.status },
    content: { id: row.content.id, status: row.content.status },
  };
  return { ...row, chain };
}

// ---------------------------------------------------------------------------
// Escopo de gestão (líderes e administradores)
// ---------------------------------------------------------------------------

/** O usuário-alvo pertence à equipe do líder? (Administrador gerencia todos.) */
export async function canManageUser(db: DB, scope: UserScope, targetUserId: string): Promise<boolean> {
  if (scope.role === "admin") return true;
  if (scope.role !== "leader") return false;
  const [target] = await db.select({ teamId: users.teamId, role: users.role }).from(users).where(eq(users.id, targetUserId));
  if (!target || !target.teamId) return false;
  if (target.role === "admin") return false;
  if (targetUserId === scope.id) return false;
  return scope.leaderTeamIds.has(target.teamId);
}

export async function assertCanManageUser(db: DB, scope: UserScope, targetUserId: string) {
  if (!(await canManageUser(db, scope, targetUserId))) throw notFound("Colaborador não encontrado na sua equipe.");
}

export function canManageArea(scope: UserScope, areaId: string, level: "view" | "edit" | "publish" = "view"): boolean {
  if (scope.role === "admin") return true;
  if (scope.role !== "leader") return false;
  if (level === "publish") return scope.leaderPublishAreaIds.has(areaId);
  if (level === "edit") return scope.leaderEditAreaIds.has(areaId);
  return scope.leaderAreaIds.has(areaId);
}

export function assertCanManageArea(scope: UserScope, areaId: string, level: "view" | "edit" | "publish" = "view") {
  if (!canManageArea(scope, areaId, level)) throw forbidden("Esta área não está sob sua responsabilidade.");
}

/** Usuários da(s) equipe(s) do líder. */
export async function managedUserIds(db: DB, scope: UserScope): Promise<string[]> {
  if (scope.role === "admin") {
    return (await db.select({ id: users.id }).from(users)).map((r) => r.id);
  }
  if (scope.leaderTeamIds.size === 0) return [];
  const rows = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(inArray(users.teamId, [...scope.leaderTeamIds]));
  return rows.filter((r) => r.role !== "admin" && r.id !== scope.id).map((r) => r.id);
}
