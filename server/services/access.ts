import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { AccessEvaluator, loadContentChain, loadModuleChain, loadScope, loadTrackChain, type UserScope } from "../authz/policy.js";
import type { AuthUser } from "../auth/sessions.js";
import { contents, modules } from "../db/schema.js";
import { forbidden, HttpError, notFound } from "../lib/errors.js";
import { audit, currentUser } from "../lib/http.js";
import { evaluateTrackAccess, restrictStructure, type TrackAccessResult } from "./catalog.js";
import { computeTrackView, loadTrackStructure, loadUserTrackState, trackDependencyLock, type TrackStructure, type TrackView } from "./learning.js";
import { hasAcceptedCurrentTerms } from "./me.js";

export interface LearnerContext {
  user: AuthUser;
  scope: UserScope;
  evaluator: AccessEvaluator;
}

export async function learnerContext(req: FastifyRequest): Promise<LearnerContext> {
  const user = currentUser(req);
  const scope = await loadScope(req.server.ctx.db, user);
  const evaluator = await AccessEvaluator.forUser(req.server.ctx.db, user, scope);
  return { user, scope, evaluator };
}

export async function requireTerms(req: FastifyRequest, userId: string) {
  if (!(await hasAcceptedCurrentTerms(req.server.ctx.db, userId))) {
    throw new HttpError(403, "terms_required", "Para acessar os conteúdos, confirme a ciência dos termos de uso e confidencialidade.");
  }
}

export interface TrackForUser {
  lc: LearnerContext;
  structure: TrackStructure;
  access: TrackAccessResult;
  view: TrackView;
  preview: boolean;
  trackLock: { locked: boolean; reason: string | null };
}

/**
 * Carrega a trilha já recortada ao que o usuário pode ver e calcula o progresso.
 * Lança 404 (inexistente/não publicada) ou 403 (sem autorização), registrando a negativa.
 */
export async function trackForUser(req: FastifyRequest, trackId: string, lcIn?: LearnerContext): Promise<TrackForUser> {
  const { db, settings } = req.server.ctx;
  const lc = lcIn ?? (await learnerContext(req));
  const base = await loadTrackChain(db, trackId);
  if (!base) throw notFound("Trilha não encontrada.");
  const decision = lc.evaluator.decide(base.chain);
  const preview = decision.reason === "admin" || decision.reason === "leader_preview";
  const structureAll = await loadTrackStructure(db, trackId, preview);
  if (!structureAll) throw notFound("Trilha não encontrada.");
  const access = evaluateTrackAccess(
    lc.evaluator,
    base.area,
    base.track,
    structureAll.modules,
    (mid) => structureAll.modules.find((m) => m.id === mid)?.contents ?? [],
  );
  if (access.access === "none") {
    if (access.reason === "unpublished") throw notFound("Trilha não encontrada.");
    await audit(req, "authz.denied", { outcome: "denied", targetType: "track", targetId: trackId });
    throw forbidden("Você ainda não tem acesso a esta trilha.", "no_access");
  }
  const structure = restrictStructure(structureAll, access);
  const reading = await settings.get("reading");
  const trackLock = await trackDependencyLock(db, lc.user.id, base.track, preview || lc.scope.role === "admin");
  const state = await loadUserTrackState(db, lc.user.id, structure);
  const view = computeTrackView(structure, state, { reading, trackLocked: trackLock });
  return { lc, structure, access, view, preview, trackLock };
}

export async function moduleTrackId(req: FastifyRequest, moduleId: string) {
  const [m] = await req.server.ctx.db.select({ trackId: modules.trackId }).from(modules).where(eq(modules.id, moduleId));
  if (!m) throw notFound("Módulo não encontrado.");
  return m.trackId;
}

/**
 * Garante que o usuário pode abrir o conteúdo: autorizado, publicado, desbloqueado
 * (pré-requisitos) e com os termos aceitos. Usado pelo leitor, anotações e comentários.
 */
export async function contentForUser(req: FastifyRequest, contentId: string, opts: { requireUnlocked?: boolean } = {}) {
  const { db } = req.server.ctx;
  const lc = await learnerContext(req);
  const chainRow = await loadContentChain(db, contentId);
  if (!chainRow) throw notFound("Conteúdo não encontrado.");
  const decision = lc.evaluator.decide(chainRow.chain);
  if (!decision.allowed) {
    if (decision.reason === "unpublished") throw notFound("Conteúdo não encontrado.");
    await audit(req, "authz.denied", { outcome: "denied", targetType: "content", targetId: contentId, metadata: { reason: decision.reason } });
    throw forbidden("Você não tem acesso a este conteúdo.", "no_access");
  }
  await requireTerms(req, lc.user.id);
  const t = await trackForUser(req, chainRow.track.id, lc);
  const mod = t.view.modules.find((m) => m.id === chainRow.module.id);
  const cv = mod?.contents.find((c) => c.id === contentId);
  if (!mod || !cv) throw forbidden("Você não tem acesso a este conteúdo.", "no_access");
  if (opts.requireUnlocked !== false && cv.locked && !t.preview) {
    throw new HttpError(403, "locked", cv.lockReason ?? "Conteúdo bloqueado por pré-requisito.");
  }
  return { ...chainRow, lc, track: t, moduleView: mod, contentView: cv, decision };
}

export async function moduleForUser(req: FastifyRequest, moduleId: string) {
  const { db } = req.server.ctx;
  const lc = await learnerContext(req);
  const row = await loadModuleChain(db, moduleId);
  if (!row) throw notFound("Módulo não encontrado.");
  const t = await trackForUser(req, row.track.id, lc);
  const mv = t.view.modules.find((m) => m.id === moduleId);
  if (!mv) {
    await audit(req, "authz.denied", { outcome: "denied", targetType: "module", targetId: moduleId });
    throw forbidden("Você não tem acesso a este módulo.", "no_access");
  }
  return { ...row, lc, track: t, moduleView: mv };
}

export async function contentExists(req: FastifyRequest, id: string) {
  const [c] = await req.server.ctx.db.select({ id: contents.id }).from(contents).where(eq(contents.id, id));
  return !!c;
}
