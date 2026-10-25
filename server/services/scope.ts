import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { loadScope, type UserScope } from "../authz/policy.js";
import type { AuthUser } from "../auth/sessions.js";
import type { DB } from "../db/client.js";
import { contents, modules, tracks } from "../db/schema.js";
import { audit, currentUser } from "../lib/http.js";
import { forbidden } from "../lib/errors.js";
import type { AccessResource } from "../../shared/domain.js";

/** Contexto de gestão: líderes (escopo das suas equipes e áreas) e administradores (tudo). */
export async function managerContext(req: FastifyRequest): Promise<{ user: AuthUser; scope: UserScope }> {
  const user = currentUser(req);
  if (user.role !== "leader" && user.role !== "admin") {
    await audit(req, "authz.denied", { outcome: "denied", metadata: { route: req.routeOptions.url } });
    throw forbidden();
  }
  return { user, scope: await loadScope(req.server.ctx.db, user) };
}

/** Área à qual um recurso (área, trilha, módulo ou conteúdo) pertence. */
export async function resourceAreaId(db: DB, type: AccessResource, id: string): Promise<string | null> {
  if (type === "area") return id;
  if (type === "track") {
    const [t] = await db.select({ areaId: tracks.areaId }).from(tracks).where(eq(tracks.id, id));
    return t?.areaId ?? null;
  }
  if (type === "module") {
    const [m] = await db.select({ areaId: tracks.areaId }).from(modules).innerJoin(tracks, eq(tracks.id, modules.trackId)).where(eq(modules.id, id));
    return m?.areaId ?? null;
  }
  const [c] = await db
    .select({ areaId: tracks.areaId })
    .from(contents)
    .innerJoin(modules, eq(modules.id, contents.moduleId))
    .innerJoin(tracks, eq(tracks.id, modules.trackId))
    .where(eq(contents.id, id));
  return c?.areaId ?? null;
}
