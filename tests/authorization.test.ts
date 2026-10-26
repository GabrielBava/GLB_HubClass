import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { leaderAreas, teamLeaders, teams } from "../server/db/schema.js";
import { buildPublishedTrack, Client, createTestApp, createUser, ensureTerms, type TestUser } from "./helpers.js";

let app: FastifyInstance;
let admin: Client;
let t1: Awaited<ReturnType<typeof buildPublishedTrack>>;
let t2: Awaited<ReturnType<typeof buildPublishedTrack>>;
let allowed: TestUser;
let stranger: TestUser;
let otherTeamMember: TestUser;
let leaderUser: TestUser;
let allowedC: Client;
let strangerC: Client;
let leaderC: Client;
let ruleId: string;

beforeAll(async () => {
  app = await createTestApp();
  await ensureTerms(app);
  const adminUser = await createUser(app, { role: "admin" });
  admin = new Client(app);
  await admin.login(adminUser);
  t1 = await buildPublishedTrack(admin, { title: "Trilha Consórcios" });
  t2 = await buildPublishedTrack(admin, { title: "Trilha Seguros" });

  const [teamX] = await app.ctx.db.insert(teams).values({ name: "Equipe X" }).returning();
  const [teamY] = await app.ctx.db.insert(teams).values({ name: "Equipe Y" }).returning();
  allowed = await createUser(app, { teamId: teamX!.id });
  stranger = await createUser(app, { teamId: teamX!.id });
  otherTeamMember = await createUser(app, { teamId: teamY!.id });
  leaderUser = await createUser(app, { role: "leader" });
  await app.ctx.db.insert(leaderAreas).values({ userId: leaderUser.id, areaId: t1.area.id });
  await app.ctx.db.insert(teamLeaders).values({ teamId: teamX!.id, userId: leaderUser.id });

  const rule = await admin.post("/api/admin/access-rules", { subjectType: "user", subjectId: allowed.id, resourceType: "track", resourceId: t1.track.id, effect: "allow" });
  ruleId = rule.json().id;

  allowedC = new Client(app);
  await allowedC.login(allowed);
  await allowedC.acceptTerms();
  strangerC = new Client(app);
  await strangerC.login(stranger);
  await strangerC.acceptTerms();
  leaderC = new Client(app);
  await leaderC.login(leaderUser);
  await leaderC.acceptTerms();
});

afterAll(async () => {
  await app.close();
});

describe("acesso a apostilas protegidas", () => {
  it("colaborador autorizado lê a apostila (metadados, página com marca d'água e texto)", async () => {
    const meta = await allowedC.get(`/api/contents/${t1.content.id}`);
    expect(meta.statusCode).toBe(200);
    expect(meta.json().version.pageCount).toBe(3);
    expect(meta.json().estimate.minutes).toBeGreaterThan(0);
    const img = await allowedC.get(`/api/contents/${t1.content.id}/pages/1/image`);
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/webp");
    expect(String(img.headers["cache-control"])).toContain("no-store");
    expect(img.headers["x-robots-tag"]).toContain("noindex");
    const text = await allowedC.get(`/api/contents/${t1.content.id}/pages/1/text`);
    expect(text.json().text).toContain("Página 1");
  });

  it("a resposta do leitor não expõe chaves de armazenamento nem URL do arquivo original", async () => {
    const body = (await allowedC.get(`/api/contents/${t1.content.id}`)).body;
    expect(body).not.toMatch(/storage|originals\/|\.pdf|pages\/[0-9a-f-]{36}/i);
  });

  it("colaborador sem autorização recebe 403 por URL direta e chamada de API", async () => {
    for (const url of [
      `/api/contents/${t1.content.id}`,
      `/api/contents/${t1.content.id}/pages/1/image`,
      `/api/contents/${t1.content.id}/pages/1/text`,
      `/api/contents/${t1.content.id}/download`,
      `/api/modules/${t1.module.id}`,
    ]) {
      const res = await strangerC.get(url);
      expect(res.statusCode, url).toBe(403);
    }
    const start = await strangerC.post(`/api/contents/${t1.content.id}/sessions`);
    expect(start.statusCode).toBe(403);
    const track = await strangerC.get(`/api/tracks/${t1.track.id}`);
    expect(track.json().locked).toBe(true);
    expect(track.json().view).toBeUndefined();
  });

  it("ver a vitrine de uma trilha bloqueada não é registrado como tentativa de acesso; abrir o módulo é", async () => {
    const deniedFor = async (targetId: string) => {
      const res = await admin.get(`/api/admin/audit?action=authz.denied&actor=${encodeURIComponent(stranger.email)}`);
      return (res.json().items as { targetId: string | null }[]).filter((i) => i.targetId === targetId).length;
    };
    const before = await deniedFor(t1.track.id);
    expect((await strangerC.get(`/api/tracks/${t1.track.id}`)).json().locked).toBe(true);
    expect(await deniedFor(t1.track.id)).toBe(before);
    // O módulo é negado na verificação da trilha, e o registro aponta para ela.
    expect((await strangerC.get(`/api/modules/${t1.module.id}`)).statusCode).toBe(403);
    expect(await deniedFor(t1.track.id)).toBe(before + 1);
  });

  it("arquivo original não tem URL pública e o download do original é só do administrador", async () => {
    const anon = new Client(app);
    expect((await anon.get(`/api/storage/originals/qualquer.pdf`)).statusCode).toBe(404);
    expect((await anon.get(`/storage/document/arquivo.pdf`)).statusCode).toBe(404);
    const detail = await admin.get(`/api/admin/contents/${t1.content.id}`);
    const versionId = detail.json().versions[0].id;
    expect((await allowedC.get(`/api/admin/versions/${versionId}/original`)).statusCode).toBe(403);
    expect((await anon.get(`/api/admin/versions/${versionId}/original`)).statusCode).toBe(401);
    const orig = await admin.get(`/api/admin/versions/${versionId}/original`);
    expect(orig.statusCode).toBe(200);
    expect(orig.headers["content-type"]).toBe("application/pdf");
  });

  it("conteúdo em rascunho não aparece para colaboradores", async () => {
    const draft = (await admin.post("/api/admin/contents", { moduleId: t1.module.id, type: "link", title: "Rascunho", externalUrl: "https://exemplo.com.br" })).json();
    expect((await allowedC.get(`/api/contents/${draft.id}`)).statusCode).toBe(404);
    const view = (await allowedC.get(`/api/tracks/${t1.track.id}`)).json().view;
    expect(JSON.stringify(view)).not.toContain(draft.id);
  });

  it("exige ciência dos termos antes de abrir conteúdos", async () => {
    const fresh = await createUser(app);
    await admin.post("/api/admin/access-rules", { subjectType: "user", subjectId: fresh.id, resourceType: "track", resourceId: t1.track.id });
    const c = new Client(app);
    await c.login(fresh);
    const res = await c.get(`/api/contents/${t1.content.id}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("terms_required");
    await c.acceptTerms();
    expect((await c.get(`/api/contents/${t1.content.id}`)).statusCode).toBe(200);
  });

  it("regra de negação prevalece sobre a permissão", async () => {
    const deny = await admin.post("/api/admin/access-rules", { subjectType: "user", subjectId: allowed.id, resourceType: "module", resourceId: t1.module.id, effect: "deny" });
    expect((await allowedC.get(`/api/contents/${t1.content.id}`)).statusCode).toBe(403);
    await admin.delete(`/api/admin/access-rules/${deny.json().id}`);
    expect((await allowedC.get(`/api/contents/${t1.content.id}`)).statusCode).toBe(200);
  });

  it("modo oculto: trilhas sem autorização somem do catálogo e da URL direta", async () => {
    await admin.put("/api/admin/settings/catalog", { lockedVisibility: "hidden" });
    app.ctx.settings.invalidate();
    const list = (await strangerC.get("/api/catalog/tracks")).json().tracks;
    expect(list.find((t: { id: string }) => t.id === t1.track.id)).toBeUndefined();
    expect((await strangerC.get(`/api/tracks/${t1.track.id}`)).statusCode).toBe(404);
    await admin.put("/api/admin/settings/catalog", { lockedVisibility: "locked" });
    app.ctx.settings.invalidate();
    const again = (await strangerC.get("/api/catalog/tracks")).json().tracks;
    expect(again.find((t: { id: string }) => t.id === t1.track.id)?.access).toBe("none");
  });
});

describe("isolamento de dados pessoais", () => {
  it("anotações são privadas: outro usuário não lê, edita nem exclui (IDOR)", async () => {
    const note = (await allowedC.post("/api/notes", { contentId: t1.content.id, page: 1, body: "Minha anotação privada" })).json();
    expect(note.id).toBeTruthy();
    const otherList = (await strangerC.get("/api/notes")).json();
    expect(otherList.find((n: { id: string }) => n.id === note.id)).toBeUndefined();
    expect((await strangerC.patch(`/api/notes/${note.id}`, { body: "invadido" })).statusCode).toBe(404);
    expect((await strangerC.delete(`/api/notes/${note.id}`)).statusCode).toBe(404);
    expect((await leaderC.get("/api/notes")).json().find((n: { id: string }) => n.id === note.id)).toBeUndefined();
    const mine = (await allowedC.get("/api/notes")).json();
    expect(mine.find((n: { id: string }) => n.id === note.id).body).toBe("Minha anotação privada");
  });

  it("não é possível criar anotação em conteúdo sem acesso", async () => {
    const res = await strangerC.post("/api/notes", { contentId: t1.content.id, body: "teste" });
    expect(res.statusCode).toBe(403);
  });

  it("sessão de leitura de outra pessoa não pode ser usada", async () => {
    const s = (await allowedC.post(`/api/contents/${t1.content.id}/sessions`)).json();
    const res = await strangerC.post(`/api/reading-sessions/${s.sessionId}/heartbeat`, { page: 1, activeSeconds: 5, viewSeconds: 5, pagesRead: [1] });
    expect(res.statusCode).toBe(404);
  });
});

describe("escopo do líder e privilégios", () => {
  it("colaborador não acessa rotas de líder nem de administrador", async () => {
    for (const url of ["/api/leader/overview", "/api/leader/validations", "/api/admin/users", "/api/admin/overview", "/api/admin/audit"]) {
      expect((await allowedC.get(url)).statusCode, url).toBe(403);
    }
    expect((await allowedC.post("/api/admin/access-rules", { subjectType: "everyone", resourceType: "track", resourceId: t2.track.id })).statusCode).toBe(403);
  });

  it("líder vê apenas a própria equipe", async () => {
    const overview = (await leaderC.get("/api/leader/overview")).json();
    const ids = overview.members.map((m: { id: string }) => m.id);
    expect(ids).toContain(allowed.id);
    expect(ids).not.toContain(otherTeamMember.id);
    expect((await leaderC.get(`/api/leader/members/${otherTeamMember.id}`)).statusCode).toBe(404);
    expect((await leaderC.get(`/api/leader/members/${allowed.id}`)).statusCode).toBe(200);
  });

  it("líder não atribui nem libera trilhas de outras áreas e não usa rotas de administrador", async () => {
    const assign = await leaderC.post("/api/leader/assignments", { userIds: [stranger.id], trackId: t2.track.id });
    expect(assign.statusCode).toBe(403);
    const grant = await leaderC.post("/api/leader/access", { userId: stranger.id, resourceType: "track", resourceId: t2.track.id, effect: "allow" });
    expect(grant.statusCode).toBe(403);
    const outsider = await leaderC.post("/api/leader/assignments", { userIds: [otherTeamMember.id], trackId: t1.track.id });
    expect(outsider.statusCode).toBe(404);
    expect((await leaderC.get("/api/admin/users")).statusCode).toBe(403);
    expect((await leaderC.patch(`/api/admin/users/${allowed.id}`, { role: "admin" })).statusCode).toBe(403);
    expect((await leaderC.post("/api/admin/areas", { name: "Nova área" })).statusCode).toBe(403);
  });

  it("líder não altera áreas, trilhas, conteúdos, avaliações nem o banco de questões, nem na própria área", async () => {
    const area = t1.area.id;
    const assessment = (await admin.post("/api/admin/assessments", { trackId: t1.track.id, moduleId: t1.module.id, title: "Fixação" })).json();
    const question = (
      await admin.post(`/api/admin/assessments/${assessment.id}/questions`, {
        type: "true_false",
        prompt: "O consórcio cobra juros?",
        options: {},
        answerKey: { value: false },
      })
    ).json();
    const attempts: [string, Promise<{ statusCode: number }>][] = [
      ["editar área", leaderC.patch(`/api/admin/areas/${area}`, { name: "Alterada" })],
      ["criar trilha", leaderC.post("/api/admin/tracks", { areaId: area, title: "Nova trilha" })],
      ["editar trilha", leaderC.patch(`/api/admin/tracks/${t1.track.id}`, { title: "Alterado" })],
      ["publicar trilha", leaderC.post(`/api/admin/tracks/${t1.track.id}/status`, { status: "draft" })],
      ["criar módulo", leaderC.post("/api/admin/modules", { trackId: t1.track.id, title: "Novo módulo" })],
      ["criar conteúdo", leaderC.post("/api/admin/contents", { moduleId: t1.module.id, type: "text", title: "Novo" })],
      ["status do conteúdo", leaderC.post(`/api/admin/contents/${t1.content.id}/status`, { status: "draft" })],
      ["criar avaliação", leaderC.post("/api/admin/assessments", { trackId: t1.track.id, title: "Nova" })],
      ["editar avaliação", leaderC.patch(`/api/admin/assessments/${assessment.id}`, { title: "Alterada" })],
      ["criar questão", leaderC.post(`/api/admin/assessments/${assessment.id}/questions`, { type: "true_false", prompt: "Pergunta?", options: {}, answerKey: { value: true } })],
      ["editar questão", leaderC.patch(`/api/admin/questions/${question.id}`, { prompt: "Alterada?" })],
      ["excluir questão", leaderC.delete(`/api/admin/questions/${question.id}`)],
      ["copiar questão", leaderC.post(`/api/admin/questions/${question.id}/copy`, { assessmentId: assessment.id })],
    ];
    for (const [label, req] of attempts) expect((await req).statusCode, label).toBe(403);
    const me = (await leaderC.get("/api/auth/me")).json();
    expect(me.canManageContent).toBe(false);
  });

  it("líder libera e revoga acesso dentro do escopo", async () => {
    expect((await strangerC.get(`/api/contents/${t1.content.id}`)).statusCode).toBe(403);
    const grant = await leaderC.post("/api/leader/access", { userId: stranger.id, resourceType: "track", resourceId: t1.track.id, effect: "allow" });
    expect(grant.statusCode).toBe(200);
    expect((await strangerC.get(`/api/contents/${t1.content.id}`)).statusCode).toBe(200);
    expect((await leaderC.delete(`/api/leader/access/${grant.json().id}`)).statusCode).toBe(200);
    // O leitor guarda a decisão por no máximo 15 s; metadados são reavaliados a cada chamada.
    expect((await strangerC.get(`/api/contents/${t1.content.id}`)).statusCode).toBe(403);
  });

  it("administrador revoga a permissão e o acesso deixa de existir", async () => {
    expect((await admin.delete(`/api/admin/access-rules/${ruleId}`)).statusCode).toBe(200);
    expect((await allowedC.get(`/api/contents/${t1.content.id}`)).statusCode).toBe(403);
    const again = await admin.post("/api/admin/access-rules", { subjectType: "user", subjectId: allowed.id, resourceType: "track", resourceId: t1.track.id });
    ruleId = again.json().id;
    expect((await allowedC.get(`/api/contents/${t1.content.id}`)).statusCode).toBe(200);
  });

  it("trilha dependente fica bloqueada até a conclusão do pré-requisito", async () => {
    const dep = await buildPublishedTrack(admin, { title: "Trilha Avançada" });
    await admin.patch(`/api/admin/tracks/${dep.track.id}`, { mode: "dependente", dependsOnTrackId: t1.track.id });
    await admin.post("/api/admin/access-rules", { subjectType: "user", subjectId: allowed.id, resourceType: "track", resourceId: dep.track.id });
    const res = await allowedC.get(`/api/contents/${dep.content.id}`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("locked");
  });
});
