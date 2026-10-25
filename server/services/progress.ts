import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { AppContext } from "../app.js";
import { certificates, enrollments } from "../db/schema.js";
import { computeTrackView, loadTrackStructure, loadUserTrackState, trackDependencyLock, type TrackView } from "./learning.js";
import { notify } from "./notifications.js";

/**
 * Recalcula o status da trilha para o usuário e grava o resumo na matrícula
 * (usado pelos painéis de líder e administrador). Emite certificado na conclusão.
 */
export async function refreshEnrollment(ctx: AppContext, userId: string, trackId: string): Promise<TrackView | null> {
  const { db } = ctx;
  const structure = await loadTrackStructure(db, trackId, false);
  if (!structure) return null;
  const state = await loadUserTrackState(db, userId, structure);
  const reading = await ctx.settings.get("reading");
  const trackLocked = await trackDependencyLock(db, userId, structure.track, false);
  const view = computeTrackView(structure, state, { reading, trackLocked });

  const now = new Date();
  let enrollment = state.enrollment;
  if (!enrollment) {
    if (!view.hasActivity) return view;
    const [created] = await db
      .insert(enrollments)
      .values({ userId, trackId, source: "self", status: view.status, progressPercent: view.percent, startedAt: now, lastActivityAt: now })
      .onConflictDoNothing()
      .returning();
    if (!created) return view;
    enrollment = created;
  }

  const newlyCompleted = view.status === "completed" && enrollment.status !== "completed";
  await db
    .update(enrollments)
    .set({
      status: view.status,
      progressPercent: view.percent,
      startedAt: enrollment.startedAt ?? (view.hasActivity ? now : null),
      completedAt: view.status === "completed" ? enrollment.completedAt ?? now : null,
      lastActivityAt: view.hasActivity ? now : enrollment.lastActivityAt,
      updatedAt: now,
    })
    .where(eq(enrollments.id, enrollment.id));

  if (newlyCompleted && structure.track.certificateEnabled) {
    const [cert] = await db
      .insert(certificates)
      .values({ userId, trackId, code: randomBytes(6).toString("hex").toUpperCase() })
      .onConflictDoNothing()
      .returning();
    if (cert) {
      await notify(ctx, {
        userId,
        type: "certificate_available",
        title: "Certificado disponível",
        body: `Parabéns! Você concluiu a trilha “${structure.track.title}”.`,
        link: `/minha-evolucao`,
        dedupeKey: `cert:${trackId}`,
      });
    }
  }
  return view;
}

export async function hasEnrollment(ctx: AppContext, userId: string, trackId: string) {
  const [row] = await ctx.db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.userId, userId), eq(enrollments.trackId, trackId)));
  return !!row;
}
