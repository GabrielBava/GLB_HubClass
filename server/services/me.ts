import { and, desc, eq, inArray } from "drizzle-orm";
import { userCode } from "../../shared/domain.js";
import type { AppContext } from "../app.js";
import type { AuthState } from "../auth/sessions.js";
import { departments, jobTitles, knowledgeAreas, leaderAreas, teamLeaders, teams, termsAcceptances, termsVersions } from "../db/schema.js";
import type { DB } from "../db/client.js";

export async function currentTerms(db: DB) {
  const [terms] = await db.select().from(termsVersions).where(eq(termsVersions.isCurrent, true)).orderBy(desc(termsVersions.publishedAt)).limit(1);
  return terms ?? null;
}

export async function hasAcceptedCurrentTerms(db: DB, userId: string): Promise<boolean> {
  const terms = await currentTerms(db);
  if (!terms) return true;
  const [row] = await db
    .select({ id: termsAcceptances.id })
    .from(termsAcceptances)
    .where(and(eq(termsAcceptances.userId, userId), eq(termsAcceptances.termsVersionId, terms.id)))
    .limit(1);
  return !!row;
}

/** Dados do usuário logado para o front-end (sem nenhum segredo além do token CSRF da própria sessão). */
export async function buildMe(ctx: AppContext, auth: AuthState) {
  const { db } = ctx;
  const u = auth.user;
  const [jobTitle] = u.jobTitleId ? await db.select().from(jobTitles).where(eq(jobTitles.id, u.jobTitleId)) : [];
  const [team] = u.teamId ? await db.select().from(teams).where(eq(teams.id, u.teamId)) : [];
  const [department] = u.departmentId ? await db.select().from(departments).where(eq(departments.id, u.departmentId)) : [];

  let leader: { areas: { id: string; name: string; canEdit: boolean; canPublish: boolean }[]; teams: { id: string; name: string }[] } | null = null;
  if (u.role === "leader") {
    const areas = await db
      .select({ id: knowledgeAreas.id, name: knowledgeAreas.name, canEdit: leaderAreas.canEdit, canPublish: leaderAreas.canPublish })
      .from(leaderAreas)
      .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, leaderAreas.areaId))
      .where(eq(leaderAreas.userId, u.id));
    const teamIds = (await db.select({ teamId: teamLeaders.teamId }).from(teamLeaders).where(eq(teamLeaders.userId, u.id))).map((r) => r.teamId);
    const ledTeams = teamIds.length ? await db.select({ id: teams.id, name: teams.name }).from(teams).where(inArray(teams.id, teamIds)) : [];
    leader = { areas, teams: ledTeams };
  }

  const terms = await currentTerms(db);
  return {
    authenticated: true as const,
    csrfToken: auth.session.csrfToken,
    sessionExpiresAt: auth.session.expiresAt.toISOString(),
    mfa: { required: auth.mfaRequired, enabled: u.mfaEnabled, satisfied: auth.mfaSatisfied },
    user: {
      id: u.id,
      code: userCode(u.seq),
      name: u.name,
      email: u.email,
      role: u.role,
      jobTitle: jobTitle?.name ?? null,
      team: team?.name ?? null,
      department: department?.name ?? null,
    },
    onboardingCompleted: u.onboardingCompletedAt !== null,
    termsAccepted: auth.mfaSatisfied ? await hasAcceptedCurrentTerms(db, u.id) : false,
    currentTermsVersion: terms?.version ?? null,
    leader,
    canManageContent: u.role === "admin" || !!leader?.areas.some((a) => a.canEdit),
  };
}
