import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { leaderAreas, teamLeaders, teams } from "../server/db/schema.js";
import { Client, createTestApp, createUser, ensureTerms, makePdf, type TestUser } from "./helpers.js";

/**
 * Critérios de aceitação da Fase 1 (seção 26 do documento), executados de ponta a ponta pela API.
 */
let app: FastifyInstance;
let admin: Client;
let leaderUser: TestUser;
let leader: Client;
let teamId: string;
const ids: Record<string, string> = {};
let collaborator: Client;
let collabCreds = { email: "joana.ferreira@exemplo.com.br", password: "Planejamento-forte-2026" };

beforeAll(async () => {
  app = await createTestApp();
  await ensureTerms(app);
  const adminUser = await createUser(app, { role: "admin", name: "Administradora Geral" });
  admin = new Client(app);
  await admin.login(adminUser);
  const [team] = await app.ctx.db.insert(teams).values({ name: "Consórcios — Equipe Sul" }).returning();
  teamId = team!.id;
  leaderUser = await createUser(app, { role: "leader", name: "Líder Consórcios", teamId });
  await app.ctx.db.insert(teamLeaders).values({ teamId, userId: leaderUser.id });
  leader = new Client(app);
});

afterAll(async () => {
  await app.close();
});

describe("Critérios de aceitação da Fase 1", () => {
  it("1. administrador cria um colaborador e envia convite seguro", async () => {
    const res = await admin.post("/api/admin/users", { name: "Joana Ferreira", email: collabCreds.email, role: "collaborator", teamId });
    expect(res.statusCode).toBe(200);
    ids.collaborator = res.json().id;
    const link: string = res.json().inviteLink;
    expect(link).toMatch(/\/convite\/[A-Za-z0-9_-]{40,}$/);
    ids.inviteToken = link.split("/convite/")[1]!;
    expect(app.ctx.mailer.outbox.some((m) => m.to === collabCreds.email && m.text.includes(link))).toBe(true);
  });

  it("2. colaborador conclui o primeiro acesso (senha, termos e boas-vindas)", async () => {
    collaborator = new Client(app);
    const accept = await collaborator.post("/api/auth/invite/accept", { token: ids.inviteToken, password: collabCreds.password });
    expect(accept.statusCode).toBe(200);
    const me = await collaborator.refreshCsrf();
    expect(me.onboardingCompleted).toBe(false);
    expect(me.termsAccepted).toBe(false);
    const ob = (await collaborator.get("/api/onboarding")).json();
    expect(ob.welcomeMessage).toContain("LIFE CLASS");
    expect((await collaborator.post("/api/onboarding/complete")).statusCode).toBe(400);
    await collaborator.post("/api/onboarding/terms", { termsVersionId: ob.terms.id, accepted: true });
    expect((await collaborator.post("/api/onboarding/complete")).statusCode).toBe(200);
    const after = await collaborator.refreshCsrf();
    expect(after.onboardingCompleted).toBe(true);
    expect(after.termsAccepted).toBe(true);
  });

  it("3. administrador cria área, trilha e módulo", async () => {
    const area = await admin.post("/api/admin/areas", { name: "Consórcios", color: "#1FB873", icon: "Building2" });
    expect(area.statusCode).toBe(200);
    ids.area = area.json().id;
    await app.ctx.db.insert(leaderAreas).values({ userId: leaderUser.id, areaId: ids.area });
    const track = await admin.post("/api/admin/tracks", {
      areaId: ids.area,
      title: "Formação de Especialista de Consórcios",
      summary: "Do funcionamento à venda consultiva.",
      mode: "obrigatoria",
      requiresLeaderValidation: true,
      certificateEnabled: true,
    });
    ids.track = track.json().id;
    const mod = await admin.post("/api/admin/modules", { trackId: ids.track, title: "Funcionamento e Contemplação" });
    ids.module = mod.json().id;
    expect(mod.statusCode).toBe(200);
  });

  it("4. administrador publica uma apostila", async () => {
    const content = await admin.post("/api/admin/contents", { moduleId: ids.module, type: "document", title: "Fundamentos do Consórcio" });
    ids.content = content.json().id;
    const up = await admin.upload(`/api/admin/contents/${ids.content}/versions`, { name: "fundamentos.pdf", type: "application/pdf", data: await makePdf(4, "Fundamentos do Consórcio") });
    expect(up.statusCode).toBe(200);
    const detail = (await admin.get(`/api/admin/contents/${ids.content}`)).json();
    expect(detail.versions[0].processingStatus).toBe("ready");
    expect(detail.versions[0].pageCount).toBe(4);
    for (const [k, id] of [["contents", ids.content], ["modules", ids.module], ["tracks", ids.track]] as const) {
      expect((await admin.post(`/api/admin/${k}/${id}/status`, { status: "published" })).statusCode).toBe(200);
    }
  });

  it("5. colaborador autorizado consegue ler a apostila", async () => {
    // Antes da autorização, não lê.
    expect((await collaborator.get(`/api/contents/${ids.content}`)).statusCode).toBe(403);
    await leader.login(leaderUser);
    const assign = await leader.post("/api/leader/assignments", { userIds: [ids.collaborator], trackId: ids.track, dueDate: "2030-12-31" });
    expect(assign.statusCode).toBe(200);
    const meta = await collaborator.get(`/api/contents/${ids.content}`);
    expect(meta.statusCode).toBe(200);
    expect(meta.json().watermark.code).toMatch(/^LC-\d{6}$/);
    const page = await collaborator.get(`/api/contents/${ids.content}/pages/2/image`);
    expect(page.statusCode).toBe(200);
    expect(page.rawPayload.length).toBeGreaterThan(1000);
  });

  it("6. colaborador não autorizado não acessa o material, nem por URL direta ou API", async () => {
    const outsider = await createUser(app);
    const c = new Client(app);
    await c.login(outsider);
    await c.acceptTerms();
    for (const url of [`/api/contents/${ids.content}`, `/api/contents/${ids.content}/pages/1/image`, `/api/contents/${ids.content}/pages/1/text`]) {
      expect((await c.get(url)).statusCode, url).toBe(403);
    }
  });

  it("7. arquivo original protegido não fica disponível por URL pública", async () => {
    const anon = new Client(app);
    const detail = (await admin.get(`/api/admin/contents/${ids.content}`)).json();
    expect(JSON.stringify(detail)).not.toMatch(/storageKey|document\/\d{4}-\d{2}\//);
    expect((await anon.get(`/api/admin/versions/${detail.versions[0].id}/original`)).statusCode).toBe(401);
    expect((await collaborator.get(`/api/contents/${ids.content}/download`)).statusCode).toBe(403);
  });

  it("8. a plataforma registra e recupera o progresso de leitura", async () => {
    const s = (await collaborator.post(`/api/contents/${ids.content}/sessions`)).json();
    let last;
    for (const pages of [[1, 2], [3, 4]]) {
      last = await collaborator.post(`/api/reading-sessions/${s.sessionId}/heartbeat`, { page: pages[1], activeSeconds: 15, viewSeconds: 15, pagesRead: pages });
      expect(last.statusCode).toBe(200);
    }
    expect(last!.json().percent).toBe(100);
    expect(last!.json().status).toBe("completed");
    const meta = (await collaborator.get(`/api/contents/${ids.content}`)).json();
    expect(meta.progress.lastPage).toBe(4);
    expect(meta.progress.activeSeconds).toBeGreaterThan(0);
  });

  it("9. colaborador cria e recupera anotações e marcadores", async () => {
    const note = await collaborator.post("/api/notes", { contentId: ids.content, page: 2, body: "Lance livre x lance embutido: revisar.", kind: "doubt" });
    expect(note.statusCode).toBe(200);
    await collaborator.post("/api/bookmarks", { contentId: ids.content, page: 3, label: "Taxa de administração" });
    const list = (await collaborator.get("/api/notes?q=lance")).json();
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("doubt");
    const marks = (await collaborator.get(`/api/bookmarks?contentId=${ids.content}`)).json();
    expect(marks[0].label).toBe("Taxa de administração");
  });

  it("10. colaborador realiza uma avaliação e consulta o resultado", async () => {
    const a = (await admin.post("/api/admin/assessments", { trackId: ids.track, moduleId: ids.module, title: "Fixação: contemplação", maxAttempts: 3 })).json();
    ids.assessment = a.id;
    expect(a.passingScore).toBe(80);
    const q1 = await admin.post(`/api/admin/assessments/${a.id}/questions`, {
      type: "single_choice",
      prompt: "Qual forma de contemplação depende de oferta do consorciado?",
      options: { choices: [{ id: "a", text: "Sorteio" }, { id: "b", text: "Lance" }] },
      answerKey: { correct: "b" },
      explanation: "O lance é uma oferta; o sorteio independe de oferta.",
    });
    expect(q1.statusCode).toBe(200);
    await admin.post(`/api/admin/assessments/${a.id}/questions`, {
      type: "true_false",
      prompt: "A taxa de administração substitui os juros de um financiamento.",
      options: {},
      answerKey: { value: true },
    });
    await admin.post(`/api/admin/assessments/${a.id}/questions`, {
      type: "numeric",
      prompt: "Carta de R$ 100.000 com taxa de administração de 15%: qual o custo da taxa (R$)?",
      options: { unit: "R$" },
      answerKey: { value: 15000, tolerance: 0 },
    });
    expect((await admin.post(`/api/admin/assessments/${a.id}/status`, { status: "published" })).statusCode).toBe(200);

    const start = await collaborator.post(`/api/assessments/${a.id}/attempts`);
    expect(start.statusCode).toBe(200);
    const attemptId = start.json().attemptId;
    const view = (await collaborator.get(`/api/attempts/${attemptId}`)).json();
    // O gabarito nunca vai para o navegador durante a tentativa.
    expect(JSON.stringify(view)).not.toMatch(/answerKey|"correct"/);
    const answers = view.questions.map((q: { id: string; type: string }) => ({
      questionId: q.id,
      response: q.type === "single_choice" ? { choice: "b" } : q.type === "true_false" ? { value: true } : { value: 15000 },
    }));
    const submit = await collaborator.post(`/api/attempts/${attemptId}/submit`, { answers });
    expect(submit.json()).toMatchObject({ status: "graded", score: 100, passed: true });
    const result = (await collaborator.get(`/api/attempts/${attemptId}`)).json();
    expect(result.attempt.passed).toBe(true);
    expect(result.questions[0].explanation !== undefined).toBe(true);
  });

  it("11. líder acompanha seus colaboradores e valida atividades", async () => {
    const act = (await admin.post("/api/admin/activities", {
      moduleId: ids.module,
      title: "Simule a explicação de sorteio e lance",
      instructions: "Grave um roteiro explicando a diferença para um cliente.",
      stage: "demonstrate",
      competency: "Explicar contemplação",
    })).json();
    await admin.post(`/api/admin/activities/${act.id}/status`, { status: "published" });
    const sub = await collaborator.post(`/api/activities/${act.id}/submissions`, { body: "Roteiro: no sorteio, todos concorrem; no lance, o cliente oferta..." });
    expect(sub.statusCode).toBe(200);

    const overview = (await leader.get("/api/leader/overview")).json();
    const member = overview.members.find((m: { id: string }) => m.id === ids.collaborator);
    expect(member).toBeTruthy();
    expect(member.pendingPractical).toBe(1);
    const queue = (await leader.get("/api/leader/validations")).json();
    expect(queue.submissions).toHaveLength(1);
    const review = await leader.post(`/api/leader/submissions/${queue.submissions[0].id}/review`, { decision: "approved", comment: "Clareza excelente." });
    expect(review.statusCode).toBe(200);

    let track = (await collaborator.get(`/api/tracks/${ids.track}`)).json();
    expect(track.view.status).toBe("pending_validation");
    expect(track.view.pillars.studied).toEqual({ done: 1, total: 1 });
    expect(track.view.pillars.assessed).toEqual({ done: 1, total: 1 });
    expect(track.view.pillars.demonstrated).toEqual({ done: 1, total: 1 });
    const pendingTracks = (await leader.get("/api/leader/validations")).json().tracks;
    expect(pendingTracks.map((t: { trackId: string }) => t.trackId)).toContain(ids.track);
    const validate = await leader.post("/api/leader/validations", { userId: ids.collaborator, trackId: ids.track, decision: "approved", comment: "Competência validada." });
    expect(validate.statusCode).toBe(200);
    track = (await collaborator.get(`/api/tracks/${ids.track}`)).json();
    expect(track.view.status).toBe("completed");
    expect(track.certificate?.code).toBeTruthy();
    const fb = await leader.post("/api/leader/feedback", { userId: ids.collaborator, body: "Ótima evolução na trilha." });
    expect(fb.statusCode).toBe(200);
    const notes = (await collaborator.get("/api/notifications")).json();
    expect(notes.items.some((n: { type: string }) => n.type === "leader_feedback")).toBe(true);
  });

  it("12. administrador altera permissões e revoga acessos", async () => {
    const deny = await admin.post("/api/admin/access-rules", { subjectType: "user", subjectId: ids.collaborator, resourceType: "content", resourceId: ids.content, effect: "deny" });
    expect(deny.statusCode).toBe(200);
    expect((await collaborator.get(`/api/contents/${ids.content}`)).statusCode).toBe(403);
    const check = (await admin.get(`/api/admin/access/check?userId=${ids.collaborator}&resourceType=content&resourceId=${ids.content}`)).json();
    expect(check).toMatchObject({ allowed: false, reason: "denied_rule" });
    await admin.delete(`/api/admin/access-rules/${deny.json().id}`);
    expect((await collaborator.get(`/api/contents/${ids.content}`)).statusCode).toBe(200);
  });

  it("14. dados persistem após logout e novo login", async () => {
    await collaborator.post("/api/auth/logout");
    expect((await collaborator.get("/api/dashboard")).statusCode).toBe(401);
    const again = new Client(app);
    const login = await again.post("/api/auth/login", collabCreds);
    expect(login.statusCode).toBe(200);
    await again.refreshCsrf();
    const meta = (await again.get(`/api/contents/${ids.content}`)).json();
    expect(meta.progress.status).toBe("completed");
    expect((await again.get("/api/notes")).json()).toHaveLength(1);
    const dash = (await again.get("/api/dashboard")).json();
    expect(dash.summary.completed).toBe(1);
    expect(dash.certificates).toHaveLength(1);
    collaborator = again;
  });

  it("13. colaborador desativado perde sessões e acesso aos conteúdos", async () => {
    expect((await admin.post(`/api/admin/users/${ids.collaborator}/deactivate`)).statusCode).toBe(200);
    expect((await collaborator.get(`/api/contents/${ids.content}`)).statusCode).toBe(401);
    expect((await collaborator.get(`/api/contents/${ids.content}/pages/1/image`)).statusCode).toBe(401);
    expect((await new Client(app).post("/api/auth/login", collabCreds)).statusCode).toBe(401);
  });

  it("registra trilha de auditoria das ações relevantes", async () => {
    const audit = (await admin.get("/api/admin/audit?action=content")).json();
    const actions = audit.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(["content.opened", "content.completed", "content.version_uploaded"]));
    const denied = (await admin.get("/api/admin/audit?outcome=denied")).json();
    expect(denied.total).toBeGreaterThan(0);
  });
});
