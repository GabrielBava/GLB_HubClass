import { and, asc, eq, inArray } from "drizzle-orm";
import { estimateReadingMinutes } from "../../shared/reading.js";
import type { AllSettings } from "../../shared/settings.js";
import type { AccessEvaluator, ChainNode } from "../authz/policy.js";
import type { DB } from "../db/client.js";
import { contents, contentVersions, enrollments, knowledgeAreas, modules, trackJobTitles, tracks } from "../db/schema.js";
import type { TrackStructure } from "./learning.js";

export type Track = typeof tracks.$inferSelect;
export type Area = typeof knowledgeAreas.$inferSelect;

export interface CatalogIndex {
  areas: Area[];
  areaById: Map<string, Area>;
  tracks: Track[];
  modulesByTrack: Map<string, { id: string; status: string; title: string }[]>;
  contentsByModule: Map<string, { id: string; status: string; title: string; type: string; isRequired: boolean; minutes: number; publishedAt: Date | null; createdAt: Date }[]>;
  jobTitlesByTrack: Map<string, string[]>;
}

/** Índice compacto do catálogo (poucas consultas) para listar trilhas com estimativas. */
export async function loadCatalogIndex(db: DB, reading: AllSettings["reading"]): Promise<CatalogIndex> {
  const [areas, trackRows, moduleRows, contentRows, jt] = await Promise.all([
    db.select().from(knowledgeAreas).orderBy(asc(knowledgeAreas.sortOrder), asc(knowledgeAreas.name)),
    db.select().from(tracks).orderBy(asc(tracks.sortOrder), asc(tracks.title)),
    db.select({ id: modules.id, trackId: modules.trackId, status: modules.status, title: modules.title }).from(modules).orderBy(asc(modules.sortOrder)),
    db
      .select({
        id: contents.id,
        moduleId: contents.moduleId,
        status: contents.status,
        title: contents.title,
        type: contents.type,
        isRequired: contents.isRequired,
        readingFactor: contents.readingFactor,
        override: contents.estimatedMinutesOverride,
        publishedAt: contents.publishedAt,
        createdAt: contents.createdAt,
        wordCount: contentVersions.wordCount,
        pageCount: contentVersions.pageCount,
      })
      .from(contents)
      .leftJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
      .orderBy(asc(contents.sortOrder)),
    db.select().from(trackJobTitles),
  ]);
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const trackById = new Map(trackRows.map((t) => [t.id, t]));
  const modulesByTrack = new Map<string, { id: string; status: string; title: string }[]>();
  const moduleTrack = new Map<string, string>();
  for (const m of moduleRows) {
    modulesByTrack.set(m.trackId, [...(modulesByTrack.get(m.trackId) ?? []), m]);
    moduleTrack.set(m.id, m.trackId);
  }
  const contentsByModule: CatalogIndex["contentsByModule"] = new Map();
  for (const c of contentRows) {
    const track = trackById.get(moduleTrack.get(c.moduleId) ?? "");
    const area = track ? areaById.get(track.areaId) : undefined;
    const minutes = estimateReadingMinutes({
      wordCount: c.wordCount ?? 0,
      pageCount: c.pageCount ?? 0,
      wordsPerMinute: area?.settings.wordsPerMinute ?? reading.wordsPerMinute,
      minutesPerPageFallback: reading.minutesPerPageFallback,
      factor: c.readingFactor,
      overrideMinutes: c.override,
    });
    contentsByModule.set(c.moduleId, [
      ...(contentsByModule.get(c.moduleId) ?? []),
      { id: c.id, status: c.status, title: c.title, type: c.type, isRequired: c.isRequired, minutes, publishedAt: c.publishedAt, createdAt: c.createdAt },
    ]);
  }
  const jobTitlesByTrack = new Map<string, string[]>();
  for (const r of jt) jobTitlesByTrack.set(r.trackId, [...(jobTitlesByTrack.get(r.trackId) ?? []), r.jobTitleId]);
  return { areas, areaById, tracks: trackRows, modulesByTrack, contentsByModule, jobTitlesByTrack };
}

export type TrackAccess = "full" | "partial" | "none";

export interface TrackAccessResult {
  access: TrackAccess;
  reason: string;
  /** Módulos e conteúdos liberados quando o acesso é parcial. */
  moduleIds: Set<string> | null;
  contentIds: Set<string> | null;
}

export function trackChain(area: Area, track: Track): ChainNode {
  return { area: { id: area.id, isVisible: area.isVisible }, track: { id: track.id, status: track.status, mode: track.mode } };
}

/**
 * Acesso a uma trilha: total (a própria trilha está liberada) ou parcial
 * (regras específicas liberam apenas alguns módulos ou conteúdos).
 */
export function evaluateTrackAccess(
  ev: AccessEvaluator,
  area: Area,
  track: Track,
  mods: { id: string; status: string }[],
  contentsOf: (moduleId: string) => { id: string; status: string }[],
): TrackAccessResult {
  const chain = trackChain(area, track);
  const d = ev.decide(chain);
  if (d.allowed) return { access: "full", reason: d.reason, moduleIds: null, contentIds: null };
  if (d.reason === "unpublished" || d.reason === "denied_rule") return { access: "none", reason: d.reason, moduleIds: null, contentIds: null };
  const moduleIds = new Set<string>();
  const contentIds = new Set<string>();
  for (const m of mods) {
    const mChain = { ...chain, module: { id: m.id, status: m.status } };
    if (ev.decide(mChain).allowed) {
      moduleIds.add(m.id);
      for (const c of contentsOf(m.id)) if (ev.decide({ ...mChain, content: { id: c.id, status: c.status } }).allowed) contentIds.add(c.id);
      continue;
    }
    for (const c of contentsOf(m.id)) {
      if (ev.decide({ ...mChain, content: { id: c.id, status: c.status } }).allowed) {
        moduleIds.add(m.id);
        contentIds.add(c.id);
      }
    }
  }
  if (moduleIds.size === 0) return { access: "none", reason: d.reason, moduleIds: null, contentIds: null };
  return { access: "partial", reason: "rule", moduleIds, contentIds };
}

/** Recorta a estrutura da trilha ao que o usuário pode ver (acesso parcial). */
export function restrictStructure(s: TrackStructure, access: TrackAccessResult): TrackStructure {
  if (access.access === "full" || !access.moduleIds || !access.contentIds) return s;
  const moduleIds = access.moduleIds;
  const contentIds = access.contentIds;
  return {
    ...s,
    modules: s.modules
      .filter((m) => moduleIds.has(m.id))
      .map((m) => ({ ...m, contents: m.contents.filter((c) => contentIds.has(c.id)) })),
    finalAssessments: [],
  };
}

export async function enrollmentMap(db: DB, userId: string, trackIds?: string[]) {
  const where = trackIds?.length ? and(eq(enrollments.userId, userId), inArray(enrollments.trackId, trackIds)) : eq(enrollments.userId, userId);
  const rows = await db.select().from(enrollments).where(where);
  return new Map(rows.map((r) => [r.trackId, r]));
}

export function trackEstimatedMinutes(index: CatalogIndex, track: Track, includeDraft = false) {
  if (track.estimatedMinutesOverride) return track.estimatedMinutesOverride;
  let total = 0;
  for (const m of index.modulesByTrack.get(track.id) ?? []) {
    if (!includeDraft && m.status !== "published") continue;
    for (const c of index.contentsByModule.get(m.id) ?? []) if (includeDraft || c.status === "published") total += c.minutes;
  }
  return total;
}

export function publishedModuleCount(index: CatalogIndex, trackId: string) {
  return (index.modulesByTrack.get(trackId) ?? []).filter((m) => m.status === "published").length;
}
