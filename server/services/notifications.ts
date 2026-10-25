import { eq } from "drizzle-orm";
import type { AppContext } from "../app.js";
import { notifications, users } from "../db/schema.js";
import { notificationEmail } from "./emails.js";
import type { NotificationType } from "../../shared/domain.js";

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
  /** Evita notificações repetidas: a mesma chave para o mesmo usuário só é criada uma vez. */
  dedupeKey?: string | null;
}

export async function notify(ctx: AppContext, input: NotifyInput): Promise<void> {
  const inserted = await ctx.db
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? "",
      link: input.link ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (!inserted.length) return;

  const prefs = await ctx.settings.get("notifications");
  if (!prefs.emailEnabled || !ctx.mailer.configured || !prefs.emailTypes.includes(input.type)) return;
  const [user] = await ctx.db.select().from(users).where(eq(users.id, input.userId));
  if (!user || user.status !== "active" || user.preferences.emailNotifications === false) return;
  const branding = await ctx.settings.get("branding");
  const msg = notificationEmail({
    name: user.name,
    title: input.title,
    body: input.body ?? "",
    link: input.link ? `${ctx.config.appOrigin}${input.link}` : null,
    platform: branding.platformName,
  });
  // O envio não bloqueia a operação principal.
  void ctx.mailer
    .send({ to: user.email, ...msg })
    .then(() => ctx.db.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, inserted[0]!.id)))
    .catch(() => undefined);
}

export async function notifyMany(ctx: AppContext, userIds: string[], input: Omit<NotifyInput, "userId">) {
  for (const userId of userIds) await notify(ctx, { ...input, userId });
}
