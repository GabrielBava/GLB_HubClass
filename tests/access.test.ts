import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { enrollments, leaderAreas, teamLeaders, teams, users } from "../server/db/schema.js";
import { applyDueOffboardings } from "../server/services/offboarding.js";
import { buildPublishedTrack, Client, createTestApp, createUser, ensureTerms, makePdf } from "./helpers.js";

let app: FastifyInstance;
let admin: Client;
let track: Awaited<ReturnType<typeof buildPublishedTrack>>;

beforeAll(async () => {
  app = await createTestApp();
  await ensureTerms(app);
  const adminUser = await createUser(app, { role: "admin" });
  admin = new Client(app);
  await admin.login(adminUser);
  // Trilha livre: qualquer usuário ativo acessa, o que isola o efeito da liberação e do desligamento.
  track = await buildPublishedTrack(admin, { mode: "livre", title: "Trilha livre" });
});

afterAll(async () => {
  await app.close();
});

async function invite(body: Record<string, unknown>) {
  const created = await admin.post("/api/admin/users", body);
  expect(created.statusCode).toBe(200);
  const token = (created.json().inviteLink as string).split("/convite/")[1]!;
  const c = new Client(app);
  expect((await c.post("/api/auth/invite/accept", { token, password: "Cerrado-azul-2026x" })).statusCode).toBe(200);
  const me = await c.refreshCsrf();
  return { c, id: me.user.id as string, me };
}

describe("primeiro acesso: liberação pelo administrador", () => {
  it("com liberação exigida, a pessoa ativa o convite e faz o primeiro acesso, mas só estuda depois de liberada", async () => {
    const { c, id, me } = await invite({ name: "Paula Aguardando Lima", email: "paula.aguarda@exemplo.com.br", approvalRequired: true });
    expect(me.user.status).toBe("pending_approval");
    // Primeiro acesso e perfil continuam disponíveis; conteúdos e painel, não.
    expect((await c.get("/api/onboarding")).statusCode).toBe(200);
    await c.acceptTerms();
    const blocked = await c.get(`/api/tracks/${track.track.id}`);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("awaiting_approval");
    expect((await c.get("/api/dashboard")).json().error.code).toBe("awaiting_approval");
    // O administrador é avisado e libera.
    const notes = (await admin.get("/api/notifications")).json();
    expect(notes.items.some((n: { type: string }) => n.type === "access_pending")).toBe(true);
    expect((await admin.post(`/api/admin/users/${id}/approve`)).statusCode).toBe(200);
    expect((await c.get(`/api/tracks/${track.track.id}`)).statusCode).toBe(200);
    const mine = (await c.get("/api/notifications")).json();
    expect(mine.items.some((n: { type: string }) => n.type === "access_released")).toBe(true);
  });

  it("o administrador pode recusar: a sessão é encerrada e o login deixa de funcionar", async () => {
    const { c, id } = await invite({ name: "Rui Recusado Prado", email: "rui.recusado@exemplo.com.br", approvalRequired: true });
    expect((await admin.post(`/api/admin/users/${id}/reject`)).statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).json().authenticated).toBe(false);
    const login = await new Client(app).post("/api/auth/login", { email: "rui.recusado@exemplo.com.br", password: "Cerrado-azul-2026x" });
    expect(login.statusCode).toBe(401);
  });

  it("sem liberação exigida (padrão), o acesso é imediato", async () => {
    const { c, me } = await invite({ name: "Lia Imediata Costa", email: "lia.imediata@exemplo.com.br" });
    expect(me.user.status).toBe("active");
    await c.acceptTerms();
    expect((await c.get(`/api/tracks/${track.track.id}`)).statusCode).toBe(200);
  });

  it("primeiro acesso opcional: sem a ciência dos termos, o conteúdo abre quando o administrador desativa a exigência", async () => {
    const u = await createUser(app);
    const c = new Client(app);
    await c.login(u);
    expect((await c.get(`/api/contents/${track.content.id}`)).json().error.code).toBe("terms_required");
    expect((await admin.put("/api/admin/settings/onboarding", { required: false })).statusCode).toBe(200);
    try {
      expect((await c.get("/api/auth/me")).json().onboardingRequired).toBe(false);
      expect((await c.get(`/api/contents/${track.content.id}`)).statusCode).toBe(200);
    } finally {
      await admin.put("/api/admin/settings/onboarding", { required: true });
    }
  });
});

describe("desligamento", () => {
  it("imediato: tranca o acesso, encerra sessões, remove a liderança e preserva o histórico", async () => {
    const leader = await createUser(app, { role: "leader" });
    const [team] = await app.ctx.db.insert(teams).values({ name: "Equipe Desligamento" }).returning();
    await app.ctx.db.insert(teamLeaders).values({ teamId: team!.id, userId: leader.id });
    await app.ctx.db.insert(leaderAreas).values({ userId: leader.id, areaId: track.area.id });
    await app.ctx.db.insert(enrollments).values({ userId: leader.id, trackId: track.track.id, source: "admin" });
    const c = new Client(app);
    await c.login(leader);
    expect((await admin.post(`/api/admin/users/${leader.id}/offboard`, { reason: "x" })).statusCode).toBe(400);
    const res = await admin.post(`/api/admin/users/${leader.id}/offboard`, { reason: "Encerramento do contrato" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ scheduled: false, leaderTeamsRemoved: 1, leaderAreasRemoved: 1 });
    expect((await c.get("/api/auth/me")).json().authenticated).toBe(false);
    const login = await new Client(app).post("/api/auth/login", { email: leader.email, password: leader.password });
    expect(login.statusCode).toBe(401);
    const [u] = await app.ctx.db.select().from(users).where(eq(users.id, leader.id));
    expect(u).toMatchObject({ status: "inactive", offboardReason: "Encerramento do contrato" });
    // O histórico de aprendizagem permanece.
    expect(await app.ctx.db.select().from(enrollments).where(eq(enrollments.userId, leader.id))).toHaveLength(1);
    const detail = (await admin.get(`/api/admin/users/${leader.id}`)).json();
    expect(detail.user.offboardReason).toBe("Encerramento do contrato");
  });

  it("agendado: vale até a data; no horário, login e sessão são recusados e a rotina conclui o desligamento", async () => {
    const u = await createUser(app);
    const c = new Client(app);
    await c.login(u);
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const res = await admin.post(`/api/admin/users/${u.id}/offboard`, { reason: "Último dia de trabalho", at });
    expect(res.json().scheduled).toBe(true);
    expect((await c.get("/api/auth/me")).json().authenticated).toBe(true);
    // Simula a chegada da data.
    await app.ctx.db.update(users).set({ offboardAt: new Date(Date.now() - 1000) }).where(eq(users.id, u.id));
    expect((await c.get("/api/auth/me")).json().authenticated).toBe(false);
    expect(await applyDueOffboardings(app.ctx.db)).toBeGreaterThanOrEqual(1);
    const [row] = await app.ctx.db.select().from(users).where(eq(users.id, u.id));
    expect(row!.status).toBe("inactive");
    expect((await new Client(app).post("/api/auth/login", { email: u.email, password: u.password })).statusCode).toBe(401);
  });

  it("o agendamento pode ser cancelado e o administrador não se desliga", async () => {
    const u = await createUser(app);
    const at = new Date(Date.now() + 86_400_000).toISOString();
    await admin.post(`/api/admin/users/${u.id}/offboard`, { reason: "Agendado por engano", at });
    expect((await admin.delete(`/api/admin/users/${u.id}/offboard`)).statusCode).toBe(200);
    const [row] = await app.ctx.db.select().from(users).where(eq(users.id, u.id));
    expect(row).toMatchObject({ status: "active", offboardAt: null });
    const self = (await admin.get("/api/auth/me")).json().user.id;
    expect((await admin.post(`/api/admin/users/${self}/offboard`, { reason: "Teste" })).statusCode).toBe(400);
  });
});

describe("biblioteca: capa e arquivo para download", () => {
  it("anexa o arquivo (download liberado e auditado) e recusa formatos inválidos e obras sem licença", async () => {
    const item = (await admin.post("/api/admin/library", { title: "Guia de Atendimento", license: "own", type: "publication" })).json();
    const fake = await admin.upload(`/api/admin/library/${item.id}/file`, { name: "planilha.xlsx", type: "application/octet-stream", data: Buffer.from("não é uma planilha") });
    expect(fake.statusCode).toBe(400);
    const ok = await admin.upload(`/api/admin/library/${item.id}/file`, { name: "guia.pdf", type: "application/pdf", data: await makePdf(2, "Guia") });
    expect(ok.statusCode).toBe(200);
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
    expect((await admin.upload(`/api/admin/library/${item.id}/cover`, { name: "capa.png", type: "image/png", data: png })).statusCode).toBe(200);

    const u = await createUser(app);
    const c = new Client(app);
    await c.login(u);
    const listed = (await c.get("/api/library")).json().items.find((i: { id: string }) => i.id === item.id);
    expect(listed).toMatchObject({ canDownload: true, download: { ext: "PDF" } });
    expect(listed.coverFileId).toBeTruthy();
    expect((await c.get(`/api/files/${listed.coverFileId}/image`)).statusCode).toBe(200);
    const dl = await c.get(`/api/library/${item.id}/file`);
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("attachment");

    const book = (await admin.post("/api/admin/library", { title: "Livro de terceiros", license: "external_only" })).json();
    const denied = await admin.upload(`/api/admin/library/${book.id}/file`, { name: "livro.pdf", type: "application/pdf", data: await makePdf(1) });
    expect(denied.statusCode).toBe(400);
    // Remover o anexo encerra o download.
    expect((await admin.delete(`/api/admin/library/${item.id}/file`)).statusCode).toBe(200);
    expect((await c.get(`/api/library/${item.id}/file`)).statusCode).toBe(404);
  });
});
