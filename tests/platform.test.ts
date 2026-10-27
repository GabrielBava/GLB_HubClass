import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { LocalStorage } from "../server/services/storage/local.js";
import type { StorageDriver } from "../server/services/storage/index.js";
import { Client, createTestApp, createUser, ensureTerms, makePdf } from "./helpers.js";

const SETUP_TOKEN = "codigo-de-configuracao-de-teste-123";
const CRON_SECRET = "segredo-da-rotina-diaria-de-teste";

/** Armazenamento que se comporta como o Vercel Blob privado (envio direto e link assinado), gravando em disco. */
function fakeBlob(dataDir: string): StorageDriver & { signedDownloadUrl(key: string, ttl: number): Promise<string>; directUploads: true } {
  const disk = new LocalStorage(path.join(dataDir, "blob"));
  return {
    kind: "vercel-blob",
    directUploads: true,
    put: (k, d, t) => disk.put(k, d, t),
    get: (k) => disk.get(k),
    delete: (k) => disk.delete(k),
    exists: (k) => disk.exists(k),
    signedDownloadUrl: async (k, ttl) => `https://loja.private.blob.vercel-storage.com/${k}?assinatura=teste&validade=${ttl}`,
  };
}

describe("configuração inicial (banco vazio)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp({ env: { SETUP_TOKEN } });
  });
  afterAll(() => app.close());

  it("cria o primeiro administrador só com o código correto e depois se desativa", async () => {
    const c = new Client(app);
    expect((await c.get("/api/setup/status")).json()).toEqual({ available: true });
    const wrong = await c.post("/api/setup", { token: "errado", name: "Pessoa Administradora", email: "adm@empresa.com.br" });
    expect(wrong.statusCode).toBe(403);
    const ok = await c.post("/api/setup", { token: SETUP_TOKEN, name: "Pessoa Administradora", email: "ADM@empresa.com.br" });
    expect(ok.statusCode).toBe(200);
    const token = (ok.json().inviteLink as string).split("/convite/")[1]!;
    // O convite ativa a conta de administrador (a verificação em duas etapas vem no primeiro login).
    const accept = await new Client(app).post("/api/auth/invite/accept", { token, password: "Cerrado-azul-2026x" });
    expect(accept.statusCode).toBe(200);
    expect((await c.get("/api/setup/status")).json()).toEqual({ available: false });
    const again = await c.post("/api/setup", { token: SETUP_TOKEN, name: "Outra Pessoa", email: "outra@empresa.com.br" });
    expect(again.statusCode).toBe(409);
  });
});

describe("diagnóstico da implantação (/api/health)", () => {
  it("aponta o que falta sem expor segredos e passa a ok quando há administrador", async () => {
    const app = await createTestApp();
    try {
      const c = new Client(app);
      const empty = await c.get("/api/health");
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toMatchObject({ ok: false, checks: { database: "ok", administrator: false } });
      expect(empty.json().problems.join(" ")).toMatch(/Nenhum administrador/);
      await createUser(app, { role: "admin" });
      expect((await c.get("/api/health")).json()).toMatchObject({ ok: true, checks: { administrator: true }, problems: [] });
    } finally {
      await app.close();
    }
  });
});

describe("sem código de configuração", () => {
  it("a configuração inicial não existe", async () => {
    const app = await createTestApp();
    try {
      const c = new Client(app);
      expect((await c.get("/api/setup/status")).json()).toEqual({ available: false });
      expect((await c.post("/api/setup", { token: "x", name: "Pessoa Teste", email: "p@empresa.com.br" })).statusCode).toBe(404);
      expect((await c.get("/api/cron/maintenance")).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe("rotina diária agendada", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp({ env: { CRON_SECRET } });
  });
  afterAll(() => app.close());

  it("exige o segredo enviado pela Vercel e devolve o resumo", async () => {
    const c = new Client(app);
    expect((await c.get("/api/cron/maintenance")).statusCode).toBe(401);
    expect((await c.request("GET", "/api/cron/maintenance", { headers: { authorization: "Bearer errado" } })).statusCode).toBe(401);
    const ok = await c.request("GET", "/api/cron/maintenance", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, offboarded: 0, documents: 0 });
  });
});

describe("envio direto e download por link assinado (Vercel Blob)", () => {
  let app: FastifyInstance;
  let admin: Client;
  let adminId: string;
  beforeAll(async () => {
    app = await createTestApp({ storage: fakeBlob });
    await ensureTerms(app);
    const u = await createUser(app, { role: "admin" });
    adminId = u.id;
    admin = new Client(app);
    await admin.login(u);
  });
  afterAll(() => app.close());

  it("o administrador recebe a pasta de envio direto; colaboradores não", async () => {
    expect((await admin.get("/api/auth/me")).json().uploads).toEqual({ direct: true, prefix: `uploads/tmp/${adminId}/` });
    const learner = new Client(app);
    await learner.login(await createUser(app));
    expect((await learner.get("/api/auth/me")).json().uploads).toEqual({ direct: false, prefix: null });
  });

  it("confirma o envio direto com as mesmas validações e apaga o arquivo temporário", async () => {
    const item = (await admin.post("/api/admin/library", { title: "Manual grande", license: "own", type: "publication" })).json();
    // Arquivo de 5 MB (acima do limite de 4,5 MB por requisição na Vercel).
    const big = Buffer.concat([await makePdf(2, "Manual"), Buffer.alloc(5 * 1024 * 1024, 32)]);
    const pathname = `uploads/tmp/${adminId}/${randomUUID()}`;
    await app.ctx.storage.put(pathname, big, "application/pdf");

    const other = `uploads/tmp/${randomUUID()}/${randomUUID()}`;
    await app.ctx.storage.put(other, big, "application/pdf");
    const foreign = await admin.post(`/api/admin/library/${item.id}/file`, { blobUpload: { pathname: other, filename: "x.pdf", contentType: "application/pdf" } });
    expect(foreign.statusCode).toBe(400);

    const ok = await admin.post(`/api/admin/library/${item.id}/file`, { blobUpload: { pathname, filename: "manual.pdf", contentType: "application/pdf" } });
    expect(ok.statusCode).toBe(200);
    expect(await app.ctx.storage.exists(pathname)).toBe(false);

    // Arquivo grande: download por link assinado de poucos minutos, só depois da verificação de permissão.
    const reader = new Client(app);
    await reader.login(await createUser(app));
    const dl = await reader.get(`/api/library/${item.id}/file`);
    expect(dl.statusCode).toBe(303);
    expect(dl.headers.location).toMatch(/^https:\/\/loja\.private\.blob\.vercel-storage\.com\/.+assinatura=teste&validade=300$/);

    const fake = `uploads/tmp/${adminId}/${randomUUID()}`;
    await app.ctx.storage.put(fake, Buffer.from("não é um PDF"), "application/pdf");
    const invalid = await admin.post(`/api/admin/library/${item.id}/file`, { blobUpload: { pathname: fake, filename: "falso.pdf", contentType: "application/pdf" } });
    expect(invalid.statusCode).toBe(400);
    expect(await app.ctx.storage.exists(fake)).toBe(false);
  });
});

describe("administrador inicial por variáveis de ambiente (deploy)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it("cria o administrador ativo uma única vez; ele entra com a senha e precisa configurar o MFA", async () => {
    const { bootstrapAdmin } = await import("../server/services/bootstrap.js");
    expect((await bootstrapAdmin(app.ctx.db, {})).status).toBe("skipped");
    await expect(bootstrapAdmin(app.ctx.db, { email: "pessoa.adm@empresa.com.br", password: "curta1" })).rejects.toThrow(/10 caracteres/);

    // Senha com sequência longa de números: aceita na criação inicial, com aviso no log do deploy.
    const created = await bootstrapAdmin(app.ctx.db, { email: "Pessoa.Adm@empresa.com.br", password: "@Teste12345678" });
    expect(created.status).toBe("created");
    expect(created.warnings.join(" ")).toMatch(/datas ou sequências/);

    const login = await new Client(app).post("/api/auth/login", { email: "pessoa.adm@empresa.com.br", password: "@Teste12345678" });
    expect(login.statusCode).toBe(200);
    expect(login.json().status).toBe("mfa_setup_required");

    // Deploys seguintes não alteram nada.
    const again = await bootstrapAdmin(app.ctx.db, { email: "pessoa.adm@empresa.com.br", password: "Outra-senha-forte-99" });
    expect(again.status).toBe("skipped");
    const relogin = await new Client(app).post("/api/auth/login", { email: "pessoa.adm@empresa.com.br", password: "@Teste12345678" });
    expect(relogin.statusCode).toBe(200);
  });
});
