import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { practicalActivities, practicalSubmissions, teamLeaders, users } from "../db/schema.js";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.js";
import { audit } from "../lib/http.js";
import { parse } from "../lib/validate.js";
import { requireTerms, trackForUser } from "../services/access.js";
import { refreshEnrollment } from "../services/progress.js";

const idParams = z.object({ id: z.string().uuid() });

export async function activityRoutes(app: FastifyInstance) {
  const { db } = app.ctx;

  async function activityFor(req: FastifyRequest, id: string) {
    const [activity] = await db.select().from(practicalActivities).where(eq(practicalActivities.id, id));
    if (!activity) throw notFound("Atividade não encontrada.");
    const t = await trackForUser(req, activity.trackId);
    const moduleView = t.view.modules.find((m) => m.activities.some((a) => a.id === id));
    const view = moduleView?.activities.find((a) => a.id === id);
    if (!view || !moduleView) {
      if (activity.status !== "published" && !t.preview) throw notFound("Atividade não encontrada.");
      await audit(req, "authz.denied", { outcome: "denied", targetType: "activity", targetId: id });
      throw forbidden("Você não tem acesso a esta atividade.", "no_access");
    }
    await requireTerms(req, t.lc.user.id);
    return { activity, view, moduleView, t };
  }

  app.get("/api/activities/:id", async (req) => {
    const { id } = parse(idParams, req.params);
    const { activity, view, moduleView, t } = await activityFor(req, id);
    const subs = await db
      .select({ s: practicalSubmissions, reviewer: users.name })
      .from(practicalSubmissions)
      .leftJoin(users, eq(users.id, practicalSubmissions.reviewedBy))
      .where(and(eq(practicalSubmissions.activityId, id), eq(practicalSubmissions.userId, t.lc.user.id)))
      .orderBy(desc(practicalSubmissions.submittedAt));
    return {
      activity: {
        id: activity.id,
        title: activity.title,
        instructions: activity.instructions,
        stage: activity.stage,
        deliverable: activity.deliverable,
        competency: activity.competency,
        requiresValidation: activity.requiresValidation,
        isRequired: activity.isRequired,
      },
      status: view.status,
      locked: view.locked && !t.preview,
      track: { id: t.structure.track.id, title: t.structure.track.title },
      module: { id: moduleView.id, title: moduleView.title },
      submissions: subs.map(({ s, reviewer }) => ({
        id: s.id,
        attemptNumber: s.attemptNumber,
        body: s.body,
        link: s.link,
        status: s.status,
        submittedAt: s.submittedAt,
        reviewedAt: s.reviewedAt,
        reviewerName: reviewer,
        reviewerComment: s.reviewerComment,
      })),
    };
  });

  app.post("/api/activities/:id/submissions", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const { id } = parse(idParams, req.params);
    const body = parse(
      z.object({
        body: z.string().trim().max(20_000).default(""),
        link: z
          .string()
          .trim()
          .max(1000)
          .url("Informe um link válido (https://...).")
          .refine((v) => /^https:\/\//i.test(v), "Use um link https.")
          .nullable()
          .optional(),
      }),
      req.body,
    );
    const { activity, view, t } = await activityFor(req, id);
    if (view.locked && !t.preview) throw new HttpError(403, "locked", "Conclua os conteúdos obrigatórios do módulo para liberar a atividade.");
    if (!body.body && !body.link) throw badRequest("Descreva a entrega ou informe um link.");
    if (view.status === "submitted") throw badRequest("Sua entrega anterior está aguardando avaliação.");
    if (view.status === "approved") throw badRequest("Esta atividade já foi aprovada.");
    const userId = t.lc.user.id;
    const previous = await db
      .select({ id: practicalSubmissions.id })
      .from(practicalSubmissions)
      .where(and(eq(practicalSubmissions.activityId, id), eq(practicalSubmissions.userId, userId)));
    const autoApproved = !activity.requiresValidation;
    const [sub] = await db
      .insert(practicalSubmissions)
      .values({
        activityId: id,
        userId,
        attemptNumber: previous.length + 1,
        body: body.body,
        link: body.link ?? null,
        status: "submitted",
      })
      .returning();
    await audit(req, "activity.submitted", { targetType: "activity", targetId: id, metadata: { submission: sub!.id } });
    await refreshEnrollment(app.ctx, userId, activity.trackId);

    // Avisa os líderes da equipe do colaborador quando há validação a fazer.
    if (!autoApproved && t.lc.user.teamId) {
      const leaders = await db.select({ userId: teamLeaders.userId }).from(teamLeaders).where(eq(teamLeaders.teamId, t.lc.user.teamId));
      const { notify } = await import("../services/notifications.js");
      for (const l of leaders) {
        await notify(app.ctx, {
          userId: l.userId,
          type: "validation_pending",
          title: "Nova atividade prática para validar",
          body: `${t.lc.user.name} enviou “${activity.title}”.`,
          link: "/lider/validacoes",
          dedupeKey: `sub:${sub!.id}`,
        });
      }
    }
    return { id: sub!.id, status: sub!.status };
  });
}
