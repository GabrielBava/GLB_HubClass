import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { LearnerTrackStatus } from "../../shared/domain.js";
import { estimateReadingMinutes } from "../../shared/reading.js";
import type { AllSettings } from "../../shared/settings.js";
import type { DB } from "../db/client.js";
import {
  assessments,
  attempts,
  contentProgress,
  contents,
  contentVersions,
  enrollments,
  knowledgeAreas,
  modules,
  practicalActivities,
  practicalSubmissions,
  tracks,
  trackValidations,
} from "../db/schema.js";

type Track = typeof tracks.$inferSelect;
type Area = typeof knowledgeAreas.$inferSelect;
type Module = typeof modules.$inferSelect;
type Content = typeof contents.$inferSelect;
type Assessment = typeof assessments.$inferSelect;
type Activity = typeof practicalActivities.$inferSelect;
type Attempt = typeof attempts.$inferSelect;
type Submission = typeof practicalSubmissions.$inferSelect;

export interface ContentWithVersion extends Content {
  version: { id: string; pageCount: number; wordCount: number; processingStatus: string } | null;
}

export interface TrackStructure {
  track: Track;
  area: Area;
  modules: (Module & { contents: ContentWithVersion[]; assessments: Assessment[]; activities: Activity[] })[];
  finalAssessments: Assessment[];
}

/** Carrega a trilha com módulos, conteúdos, avaliações e atividades (só publicados, salvo pré-visualização). */
export async function loadTrackStructure(db: DB, trackId: string, includeUnpublished = false): Promise<TrackStructure | null> {
  const [row] = await db
    .select({ track: tracks, area: knowledgeAreas })
    .from(tracks)
    .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, tracks.areaId))
    .where(eq(tracks.id, trackId));
  if (!row) return null;
  const visible = (status: string) => includeUnpublished ? status !== "archived" : status === "published";

  const mods = (await db.select().from(modules).where(eq(modules.trackId, trackId)).orderBy(asc(modules.sortOrder), asc(modules.createdAt))).filter((m) =>
    visible(m.status),
  );
  const moduleIds = mods.map((m) => m.id);
  const contentRows = moduleIds.length
    ? await db
        .select({ content: contents, version: contentVersions })
        .from(contents)
        .leftJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
        .where(inArray(contents.moduleId, moduleIds))
        .orderBy(asc(contents.sortOrder), asc(contents.createdAt))
    : [];
  const assessmentRows = (
    await db.select().from(assessments).where(eq(assessments.trackId, trackId)).orderBy(asc(assessments.sortOrder), asc(assessments.createdAt))
  ).filter((a) => visible(a.status));
  const activityRows = (
    await db.select().from(practicalActivities).where(eq(practicalActivities.trackId, trackId)).orderBy(asc(practicalActivities.sortOrder))
  ).filter((a) => visible(a.status));

  return {
    track: row.track,
    area: row.area,
    modules: mods.map((m) => ({
      ...m,
      contents: contentRows
        .filter((c) => c.content.moduleId === m.id && visible(c.content.status))
        .map((c) => ({
          ...c.content,
          version: c.version
            ? { id: c.version.id, pageCount: c.version.pageCount, wordCount: c.version.wordCount, processingStatus: c.version.processingStatus }
            : null,
        })),
      assessments: assessmentRows.filter((a) => a.moduleId === m.id),
      activities: activityRows.filter((a) => a.moduleId === m.id),
    })),
    finalAssessments: assessmentRows.filter((a) => a.moduleId === null),
  };
}

export interface UserTrackState {
  progress: Map<string, typeof contentProgress.$inferSelect>;
  attempts: Map<string, Attempt[]>;
  submissions: Map<string, Submission[]>;
  validation: typeof trackValidations.$inferSelect | null;
  enrollment: typeof enrollments.$inferSelect | null;
}

export async function loadUserTrackState(db: DB, userId: string, s: TrackStructure): Promise<UserTrackState> {
  const contentIds = s.modules.flatMap((m) => m.contents.map((c) => c.id));
  const assessmentIds = [...s.modules.flatMap((m) => m.assessments.map((a) => a.id)), ...s.finalAssessments.map((a) => a.id)];
  const activityIds = s.modules.flatMap((m) => m.activities.map((a) => a.id));

  const [progressRows, attemptRows, submissionRows, validationRows, enrollmentRows] = await Promise.all([
    contentIds.length
      ? db.select().from(contentProgress).where(and(eq(contentProgress.userId, userId), inArray(contentProgress.contentId, contentIds)))
      : Promise.resolve([]),
    assessmentIds.length
      ? db
          .select()
          .from(attempts)
          .where(and(eq(attempts.userId, userId), inArray(attempts.assessmentId, assessmentIds)))
          .orderBy(asc(attempts.attemptNumber))
      : Promise.resolve([]),
    activityIds.length
      ? db
          .select()
          .from(practicalSubmissions)
          .where(and(eq(practicalSubmissions.userId, userId), inArray(practicalSubmissions.activityId, activityIds)))
          .orderBy(desc(practicalSubmissions.submittedAt))
      : Promise.resolve([]),
    db
      .select()
      .from(trackValidations)
      .where(and(eq(trackValidations.userId, userId), eq(trackValidations.trackId, s.track.id)))
      .orderBy(desc(trackValidations.createdAt))
      .limit(1),
    db.select().from(enrollments).where(and(eq(enrollments.userId, userId), eq(enrollments.trackId, s.track.id))).limit(1),
  ]);

  const attemptsMap = new Map<string, Attempt[]>();
  for (const a of attemptRows) attemptsMap.set(a.assessmentId, [...(attemptsMap.get(a.assessmentId) ?? []), a]);
  const subsMap = new Map<string, Submission[]>();
  for (const sub of submissionRows) subsMap.set(sub.activityId, [...(subsMap.get(sub.activityId) ?? []), sub]);
  return {
    progress: new Map(progressRows.map((p) => [p.contentId, p])),
    attempts: attemptsMap,
    submissions: subsMap,
    validation: validationRows[0] ?? null,
    enrollment: enrollmentRows[0] ?? null,
  };
}

export type AssessmentUserStatus = "not_started" | "in_progress" | "pending_review" | "passed" | "failed" | "failed_final";
export type ActivityUserStatus = "not_submitted" | "submitted" | "approved" | "rejected" | "returned";

export interface AssessmentView {
  id: string;
  title: string;
  kind: string;
  isRequired: boolean;
  requiresPassToAdvance: boolean;
  passingScore: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  attemptsUsed: number;
  bestScore: number | null;
  status: AssessmentUserStatus;
  locked: boolean;
  draft: boolean;
}

export interface ActivityView {
  id: string;
  title: string;
  stage: string;
  competency: string;
  isRequired: boolean;
  requiresValidation: boolean;
  status: ActivityUserStatus;
  done: boolean;
  locked: boolean;
  draft: boolean;
}

export interface ContentView {
  id: string;
  title: string;
  type: string;
  description: string;
  isRequired: boolean;
  estimatedMinutes: number;
  pageCount: number;
  status: "not_started" | "in_progress" | "completed";
  percent: number;
  lastPage: number;
  locked: boolean;
  lockReason: string | null;
  available: boolean;
  draft: boolean;
}

export interface ModuleView {
  id: string;
  code: string | null;
  title: string;
  description: string;
  objectives: string;
  locked: boolean;
  lockReason: string | null;
  status: "not_started" | "in_progress" | "completed";
  percent: number;
  estimatedMinutes: number;
  contents: ContentView[];
  assessments: AssessmentView[];
  activities: ActivityView[];
  draft: boolean;
}

export interface Pillar {
  done: number;
  total: number;
}

export interface TrackView {
  status: LearnerTrackStatus;
  percent: number;
  estimatedMinutes: number;
  remainingMinutes: number;
  pillars: { studied: Pillar; assessed: Pillar; demonstrated: Pillar; applied: Pillar };
  validation: { required: boolean; status: "none" | "approved" | "rejected"; comment: string | null };
  modules: ModuleView[];
  finalAssessments: AssessmentView[];
  next: { kind: "content" | "assessment" | "activity"; id: string; title: string; moduleId: string | null } | null;
  hasActivity: boolean;
}

function assessmentStatus(a: Assessment, list: Attempt[] | undefined): { status: AssessmentUserStatus; best: number | null; used: number } {
  const all = list ?? [];
  const graded = all.filter((x) => x.status === "graded");
  const best = graded.length ? Math.max(...graded.map((x) => x.score ?? 0)) : null;
  if (graded.some((x) => x.passed)) return { status: "passed", best, used: all.length };
  const open = all.find((x) => x.status === "in_progress" && (!x.expiresAt || x.expiresAt.getTime() > Date.now()));
  if (open) return { status: "in_progress", best, used: all.length };
  if (all.some((x) => x.status === "pending_review")) return { status: "pending_review", best, used: all.length };
  if (graded.length) {
    const exhausted = a.maxAttempts !== null && all.length >= a.maxAttempts;
    return { status: exhausted ? "failed_final" : "failed", best, used: all.length };
  }
  return { status: "not_started", best, used: all.length };
}

export interface ComputeOptions {
  reading: AllSettings["reading"];
  trackLocked?: { locked: boolean; reason: string | null };
}

export function contentEstimate(c: ContentWithVersion, area: Area, reading: AllSettings["reading"]) {
  return estimateReadingMinutes({
    wordCount: c.version?.wordCount ?? 0,
    pageCount: c.version?.pageCount ?? 0,
    wordsPerMinute: area.settings.wordsPerMinute ?? reading.wordsPerMinute,
    minutesPerPageFallback: reading.minutesPerPageFallback,
    factor: c.readingFactor,
    overrideMinutes: c.estimatedMinutesOverride,
  });
}

/** Calcula status, percentual, pilares, bloqueios e próximo passo de uma trilha para o usuário. */
export function computeTrackView(s: TrackStructure, st: UserTrackState, opts: ComputeOptions): TrackView {
  const trackLocked = opts.trackLocked?.locked ?? false;
  const contentDone = (id: string) => st.progress.get(id)?.status === "completed";

  let estimated = 0;
  let remaining = 0;
  let items = 0;
  let doneItems = 0;
  const pillars = {
    studied: { done: 0, total: 0 },
    assessed: { done: 0, total: 0 },
    demonstrated: { done: 0, total: 0 },
    applied: { done: 0, total: 0 },
  };
  let anyFailure = false;
  let anyActivity = false;
  let previousGateOpen = true;
  let next: TrackView["next"] = null;

  const viewAssessment = (a: Assessment, locked: boolean): AssessmentView => {
    const r = assessmentStatus(a, st.attempts.get(a.id));
    if (r.used > 0) anyActivity = true;
    if (a.isRequired) {
      items++;
      pillars.assessed.total++;
      if (r.status === "passed") {
        doneItems++;
        pillars.assessed.done++;
      }
      if (r.status === "failed_final") anyFailure = true;
    }
    return {
      id: a.id,
      title: a.title,
      kind: a.kind,
      isRequired: a.isRequired,
      requiresPassToAdvance: a.requiresPassToAdvance,
      passingScore: a.passingScore,
      maxAttempts: a.maxAttempts,
      timeLimitMinutes: a.timeLimitMinutes,
      attemptsUsed: r.used,
      bestScore: r.best,
      status: r.status,
      locked,
      draft: a.status !== "published",
    };
  };

  const moduleViews: ModuleView[] = s.modules.map((m) => {
    const moduleLocked = trackLocked || (m.requiresPrevious && !previousGateOpen);
    let moduleEst = 0;
    let moduleItems = 0;
    let moduleDone = 0;
    let moduleStarted = false;

    const contentViews: ContentView[] = m.contents.map((c) => {
      const p = st.progress.get(c.id);
      const est = contentEstimate(c, s.area, opts.reading);
      const percent = p?.percent ?? 0;
      const status = p?.status ?? "not_started";
      if (status !== "not_started") {
        moduleStarted = true;
        anyActivity = true;
      }
      const depLocked = !!c.dependsOnContentId && !contentDone(c.dependsOnContentId);
      const available = c.type !== "document" || c.version?.processingStatus === "ready";
      moduleEst += est;
      estimated += est;
      if (c.isRequired) {
        items++;
        moduleItems++;
        pillars.studied.total++;
        if (status === "completed") {
          doneItems++;
          moduleDone++;
          pillars.studied.done++;
        } else {
          doneItems += percent / 100;
          moduleDone += percent / 100;
        }
      }
      if (status !== "completed") remaining += Math.round(est * (1 - percent / 100));
      return {
        id: c.id,
        title: c.title,
        type: c.type,
        description: c.description,
        isRequired: c.isRequired,
        estimatedMinutes: est,
        pageCount: c.version?.pageCount ?? 0,
        status,
        percent,
        lastPage: p?.lastPage ?? 1,
        locked: moduleLocked || depLocked,
        lockReason: moduleLocked ? (trackLocked ? opts.trackLocked?.reason ?? null : "Conclua o módulo anterior.") : depLocked ? "Conclua o conteúdo anterior." : null,
        available,
        draft: c.status !== "published",
      };
    });

    const requiredContentsDone = m.contents.filter((c) => c.isRequired).every((c) => contentDone(c.id));
    const assessmentViews = m.assessments.map((a) => viewAssessment(a, moduleLocked || !requiredContentsDone));
    for (const a of assessmentViews) {
      if (!a.isRequired) continue;
      moduleItems++;
      if (a.status === "passed") moduleDone++;
      if (a.status !== "not_started") moduleStarted = true;
    }

    const activityViews: ActivityView[] = m.activities.map((act) => {
      const latest = st.submissions.get(act.id)?.[0];
      const status: ActivityUserStatus = latest ? latest.status : "not_submitted";
      const done = status === "approved" || (status === "submitted" && !act.requiresValidation);
      if (latest) {
        anyActivity = true;
        moduleStarted = true;
      }
      if (act.isRequired) {
        items++;
        moduleItems++;
        const pillar = act.stage === "execute" ? pillars.applied : pillars.demonstrated;
        pillar.total++;
        if (done) {
          doneItems++;
          moduleDone++;
          pillar.done++;
        }
        if (status === "rejected" || status === "returned") anyFailure = true;
      }
      return {
        id: act.id,
        title: act.title,
        stage: act.stage,
        competency: act.competency,
        isRequired: act.isRequired,
        requiresValidation: act.requiresValidation,
        status,
        done,
        locked: moduleLocked || !requiredContentsDone,
        draft: act.status !== "published",
      };
    });

    // Próximo passo recomendado: primeiro item pendente e liberado, na ordem pedagógica.
    if (!next && !moduleLocked) {
      const c = contentViews.find((x) => !x.locked && x.available && x.status !== "completed");
      if (c) next = { kind: "content", id: c.id, title: c.title, moduleId: m.id };
      else {
        const a = assessmentViews.find((x) => !x.locked && x.isRequired && ["not_started", "in_progress", "failed"].includes(x.status));
        if (a) next = { kind: "assessment", id: a.id, title: a.title, moduleId: m.id };
        else {
          const act = activityViews.find((x) => !x.locked && x.isRequired && ["not_submitted", "returned"].includes(x.status));
          if (act) next = { kind: "activity", id: act.id, title: act.title, moduleId: m.id };
        }
      }
    }

    // Portão para o próximo módulo: conteúdos obrigatórios concluídos e avaliações que exigem aprovação aprovadas.
    const gateAssessmentsOk = assessmentViews.filter((a) => a.isRequired && a.requiresPassToAdvance).every((a) => a.status === "passed");
    previousGateOpen = requiredContentsDone && gateAssessmentsOk;

    const percent = moduleItems ? Math.round((moduleDone / moduleItems) * 100) : 0;
    const allDone = moduleItems > 0 && moduleDone >= moduleItems;
    return {
      id: m.id,
      code: m.code,
      title: m.title,
      description: m.description,
      objectives: m.objectives,
      locked: moduleLocked,
      lockReason: moduleLocked ? (trackLocked ? opts.trackLocked?.reason ?? null : "Conclua o módulo anterior para liberar.") : null,
      status: allDone ? "completed" : moduleStarted ? "in_progress" : "not_started",
      percent,
      estimatedMinutes: m.estimatedMinutesOverride ?? moduleEst,
      contents: contentViews,
      assessments: assessmentViews,
      activities: activityViews,
      draft: m.status !== "published",
    };
  });

  const allRequiredContentsDone = s.modules.every((m) => m.contents.filter((c) => c.isRequired).every((c) => contentDone(c.id)));
  const finalViews = s.finalAssessments.map((a) => viewAssessment(a, trackLocked || !allRequiredContentsDone));
  if (!next && !trackLocked) {
    const a = finalViews.find((x) => !x.locked && x.isRequired && ["not_started", "in_progress", "failed"].includes(x.status));
    if (a) next = { kind: "assessment", id: a.id, title: a.title, moduleId: null };
  }

  const validationRequired = s.track.requiresLeaderValidation;
  const validationStatus = st.validation ? st.validation.decision : "none";
  if (validationRequired) {
    items++;
    if (validationStatus === "approved") doneItems++;
    if (validationStatus === "rejected") anyFailure = true;
  }

  const allAssessments = [...moduleViews.flatMap((m) => m.assessments), ...finalViews].filter((a) => a.isRequired);
  const allActivities = moduleViews.flatMap((m) => m.activities).filter((a) => a.isRequired);
  const assessmentsPassed = allAssessments.every((a) => a.status === "passed");
  const activitiesDone = allActivities.every((a) => a.done);
  const activitiesAllSubmitted = allActivities.every((a) => a.status !== "not_submitted" && a.status !== "returned" && a.status !== "rejected");

  let status: LearnerTrackStatus;
  if (items === 0) status = "not_started";
  else if (anyFailure && !(assessmentsPassed && activitiesDone && validationStatus === "approved")) status = "needs_revision";
  else if (allRequiredContentsDone && assessmentsPassed && activitiesDone && (!validationRequired || validationStatus === "approved")) status = "completed";
  else if (allRequiredContentsDone && assessmentsPassed && activitiesAllSubmitted) status = "pending_validation";
  else if (allRequiredContentsDone && !assessmentsPassed) status = "pending_assessment";
  else status = anyActivity ? "in_progress" : "not_started";

  const estimatedMinutes = s.track.estimatedMinutesOverride ?? estimated;
  return {
    status,
    percent: status === "completed" ? 100 : items ? Math.min(99, Math.round((doneItems / items) * 100)) : 0,
    estimatedMinutes,
    remainingMinutes: status === "completed" ? 0 : Math.min(remaining, estimatedMinutes || remaining),
    pillars,
    validation: { required: validationRequired, status: validationStatus, comment: st.validation?.comment ?? null },
    modules: moduleViews,
    finalAssessments: finalViews,
    next,
    hasActivity: anyActivity,
  };
}

/** Bloqueio de trilha dependente: libera quando a trilha de pré-requisito estiver concluída. */
export async function trackDependencyLock(db: DB, userId: string, track: Track, bypass: boolean) {
  if (bypass || track.mode !== "dependente" || !track.dependsOnTrackId) return { locked: false, reason: null };
  const [dep] = await db
    .select({ status: enrollments.status, title: tracks.title })
    .from(tracks)
    .leftJoin(enrollments, and(eq(enrollments.trackId, tracks.id), eq(enrollments.userId, userId)))
    .where(eq(tracks.id, track.dependsOnTrackId));
  if (!dep) return { locked: false, reason: null };
  if (dep.status === "completed") return { locked: false, reason: null };
  return { locked: true, reason: `Conclua a trilha “${dep.title}” para liberar.` };
}
