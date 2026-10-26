import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { auditLogs, sessions, users } from "../server/db/schema.js";
import { Client, createTestApp, createUser, ensureTerms, generateTotp, ORIGIN } from "./helpers.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
  await ensureTerms(app);
});
afterAll(async () => {
  await app.close();
});

describe("autenticação e sessões", () => {
  it("rejeita senha errada sem revelar se o e-mail existe", async () => {
    const u = await createUser(app);
    const c = new Client(app);
    const wrong = await c.post("/api/auth/login", { email: u.email, password: "errada-123456" });
    const ghost = await c.post("/api/auth/login", { email: "ninguem@exemplo.com.br", password: "errada-123456" });
    expect(wrong.statusCode).toBe(401);
    expect(ghost.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(ghost.json().error.message);
  });

  it("faz login de colaborador com cookie HttpOnly, SameSite=Strict e sem token no corpo", async () => {
    const u = await createUser(app);
    const c = new Client(app);
    const res = await c.post("/api/auth/login", { email: u.email.toUpperCase(), password: u.password });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const me = await c.refreshCsrf();
    expect(me.authenticated).toBe(true);
    expect(me.user.email).toBe(u.email);
    expect(JSON.stringify(me)).not.toContain(u.password);
  });

  it("bloqueia a conta após tentativas excessivas", async () => {
    const u = await createUser(app);
    const c = new Client(app);
    for (let i = 0; i < 5; i++) await c.post("/api/auth/login", { email: u.email, password: "senha-errada-1" });
    const res = await c.post("/api/auth/login", { email: u.email, password: u.password });
    expect(res.statusCode).toBe(429);
    const [row] = await app.ctx.db.select().from(users).where(eq(users.id, u.id));
    expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("exige CSRF e origem válida em requisições que alteram dados", async () => {
    const u = await createUser(app);
    const c = new Client(app);
    await c.login(u);
    const noCsrf = await app.inject({
      method: "POST",
      url: "/api/notifications/read-all",
      headers: { cookie: c.cookie!, origin: ORIGIN },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe("csrf");
    const badOrigin = await app.inject({
      method: "POST",
      url: "/api/notifications/read-all",
      headers: { cookie: c.cookie!, origin: "https://atacante.example", "x-csrf-token": c.csrf! },
    });
    expect(badOrigin.statusCode).toBe(403);
    expect(badOrigin.json().error.code).toBe("bad_origin");
    const ok = await c.post("/api/notifications/read-all");
    expect(ok.statusCode).toBe(200);
  });

  it("nega por padrão rotas da API sem sessão", async () => {
    const anon = new Client(app);
    for (const url of ["/api/dashboard", "/api/catalog/tracks", "/api/admin/users", "/api/notes", "/api/leader/overview"]) {
      const res = await anon.get(url);
      expect(res.statusCode, url).toBe(401);
    }
  });

  it("administrador precisa de MFA: sessão parcial não acessa nada além do MFA", async () => {
    const admin = await createUser(app, { role: "admin" });
    const c = new Client(app);
    const res = await c.post("/api/auth/login", { email: admin.email, password: admin.password });
    expect(res.json().status).toBe("mfa_required");
    await c.refreshCsrf();
    const blocked = await c.get("/api/admin/users");
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("mfa_required");
    const oldCookie = c.cookie;
    const v = await c.post("/api/auth/mfa/verify", { code: generateTotp(admin.totpSecret!) });
    expect(v.statusCode).toBe(200);
    // A sessão é trocada após a verificação (proteção contra fixação de sessão).
    expect(c.cookie).not.toBe(oldCookie);
    await c.refreshCsrf();
    expect((await c.get("/api/admin/users")).statusCode).toBe(200);
    // O mesmo código não pode ser reutilizado.
    const c2 = new Client(app);
    await c2.post("/api/auth/login", { email: admin.email, password: admin.password });
    await c2.refreshCsrf();
    const replay = await c2.post("/api/auth/mfa/verify", { code: generateTotp(admin.totpSecret!) });
    expect(replay.statusCode).toBe(400);
  });

  it("líder sem MFA configurado é levado à configuração e ativa com código", async () => {
    const leader = await createUser(app, { role: "leader" });
    await app.ctx.db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq(users.id, leader.id));
    const c = new Client(app);
    const res = await c.post("/api/auth/login", { email: leader.email, password: leader.password });
    expect(res.json().status).toBe("mfa_setup_required");
    await c.refreshCsrf();
    const setup = await c.post("/api/auth/mfa/setup");
    expect(setup.statusCode).toBe(200);
    expect(setup.json().qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const enable = await c.post("/api/auth/mfa/enable", { code: generateTotp(setup.json().secret) });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().recoveryCodes).toHaveLength(8);
    await c.refreshCsrf();
    expect((await c.get("/api/leader/overview")).statusCode).toBe(200);
    const [row] = await app.ctx.db.select().from(users).where(eq(users.id, leader.id));
    expect(row!.mfaSecretEnc).not.toContain(setup.json().secret);
  });

  it("convite: o administrador cria o usuário, o link ativa o acesso uma única vez", async () => {
    const admin = await createUser(app, { role: "admin" });
    const ac = new Client(app);
    await ac.login(admin);
    const created = await ac.post("/api/admin/users", { name: "Maria Convidada Souza", email: "maria.convidada@exemplo.com.br", role: "collaborator" });
    expect(created.statusCode).toBe(200);
    const link: string = created.json().inviteLink;
    expect(link).toContain("/convite/");
    const token = link.split("/convite/")[1]!;
    const c = new Client(app);
    const info = await c.get(`/api/auth/invite/${token}`);
    expect(info.json().email).toBe("maria.convidada@exemplo.com.br");
    const weak = await c.post("/api/auth/invite/accept", { token, password: "maria12345" });
    expect(weak.statusCode).toBe(400);
    const ok = await c.post("/api/auth/invite/accept", { token, password: "Horizonte-verde-42" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("ok");
    const again = await new Client(app).post("/api/auth/invite/accept", { token, password: "Outra-senha-forte-7" });
    expect(again.statusCode).toBe(404);
  });

  it("recuperação de senha: resposta genérica, link de uso único e revogação das sessões", async () => {
    const u = await createUser(app);
    const c = new Client(app);
    await c.login(u);
    const anon = new Client(app);
    const res = await anon.post("/api/auth/password/forgot", { email: u.email });
    const ghost = await anon.post("/api/auth/password/forgot", { email: "nao.existe@exemplo.com.br" });
    expect(res.json().message).toBe(ghost.json().message);
    const mail = app.ctx.mailer.outbox.filter((m) => m.to === u.email).pop()!;
    const token = mail.text.match(/redefinir-senha\/([A-Za-z0-9_-]+)/)![1]!;
    const reset = await anon.post("/api/auth/password/reset", { token, password: "Nova-senha-segura-88" });
    expect(reset.statusCode).toBe(200);
    // A sessão antiga deixa de valer.
    expect((await c.get("/api/dashboard")).statusCode).toBe(401);
    const reuse = await anon.post("/api/auth/password/reset", { token, password: "Mais-uma-senha-99x" });
    expect(reuse.statusCode).toBe(404);
  });

  it("sem SMTP, o administrador gera o link de redefinição de senha; outros perfis não", async () => {
    const adminUser = await createUser(app, { role: "admin" });
    const admin = new Client(app);
    await admin.login(adminUser);
    const u = await createUser(app);
    const c = new Client(app);
    await c.login(u);
    expect((await c.post(`/api/admin/users/${u.id}/password-reset`)).statusCode).toBe(403);
    const res = await admin.post(`/api/admin/users/${u.id}/password-reset`);
    expect(res.statusCode).toBe(200);
    expect(res.json().emailed).toBe(false);
    const token = (res.json().inviteLink as string).split("/redefinir-senha/")[1]!;
    const anon = new Client(app);
    expect((await anon.post("/api/auth/password/reset", { token, password: "Senha-nova-do-admin-42" })).statusCode).toBe(200);
    expect((await c.get("/api/dashboard")).statusCode).toBe(401);
    const logs = await app.ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "user.password_reset_link"));
    expect(logs.some((l) => l.targetId === u.id)).toBe(true);
  });

  it("usuário desativado perde a sessão imediatamente", async () => {
    const admin = await createUser(app, { role: "admin" });
    const u = await createUser(app);
    const ac = new Client(app);
    await ac.login(admin);
    const c = new Client(app);
    await c.login(u);
    expect((await c.get("/api/dashboard")).statusCode).toBe(200);
    const d = await ac.post(`/api/admin/users/${u.id}/deactivate`);
    expect(d.statusCode).toBe(200);
    expect((await c.get("/api/dashboard")).statusCode).toBe(401);
    const relogin = await new Client(app).post("/api/auth/login", { email: u.email, password: u.password });
    expect(relogin.statusCode).toBe(401);
    const active = await app.ctx.db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(active.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it("registra eventos de autenticação na auditoria, que não aceita alteração", async () => {
    const logs = await app.ctx.db.select().from(auditLogs).where(eq(auditLogs.action, "auth.login"));
    expect(logs.length).toBeGreaterThan(0);
    await expect(app.ctx.db.update(auditLogs).set({ action: "x" }).where(eq(auditLogs.id, logs[0]!.id))).rejects.toThrow();
    await expect(app.ctx.db.delete(auditLogs).where(eq(auditLogs.id, logs[0]!.id))).rejects.toThrow();
  });
});
