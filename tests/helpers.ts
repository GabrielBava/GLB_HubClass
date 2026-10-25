import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { buildApp } from "../server/app.js";
import { loadConfig } from "../server/config.js";
import { hashPassword } from "../server/auth/password.js";
import { generateMfaSecret, generateTotp } from "../server/auth/mfa.js";
import { termsVersions, users } from "../server/db/schema.js";
import type { Role } from "../shared/domain.js";

export const ORIGIN = "http://localhost:5173";

export async function createTestApp(): Promise<FastifyInstance> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lifeclass-test-"));
  const config = loadConfig({
    NODE_ENV: "test",
    APP_SECRET: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
    DATA_DIR: dir,
    APP_ORIGIN: ORIGIN,
  } as NodeJS.ProcessEnv);
  config.embeddedDbDir = ":memory:";
  config.processDocumentsInline = true;
  config.docx.enabled = false;
  const app = await buildApp(config);
  await app.ready();
  return app;
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: Role;
  totpSecret: string | null;
}

let counter = 0;

/** Cria um usuário ativo diretamente no banco (administradores e líderes já com MFA configurado). */
export async function createUser(
  app: FastifyInstance,
  opts: { role?: Role; name?: string; teamId?: string | null; jobTitleId?: string | null; departmentId?: string | null; status?: "active" | "invited" | "inactive" } = {},
): Promise<TestUser> {
  counter++;
  const role = opts.role ?? "collaborator";
  const email = `pessoa${counter}.${role}@exemplo.com.br`;
  const password = `Teste-forte-${counter}-xyz9`;
  const needsMfa = role === "admin" || role === "leader";
  const totpSecret = needsMfa ? generateMfaSecret() : null;
  const [u] = await app.ctx.db
    .insert(users)
    .values({
      email,
      name: opts.name ?? `Pessoa Teste ${counter}`,
      role,
      status: opts.status ?? "active",
      passwordHash: await hashPassword(password),
      teamId: opts.teamId ?? null,
      jobTitleId: opts.jobTitleId ?? null,
      departmentId: opts.departmentId ?? null,
      mfaEnabled: needsMfa,
      mfaSecretEnc: totpSecret ? app.ctx.secrets.encrypt(totpSecret) : null,
      onboardingCompletedAt: new Date(),
    })
    .returning();
  return { id: u!.id, email, password, role, totpSecret };
}

export async function ensureTerms(app: FastifyInstance) {
  const [cur] = await app.ctx.db.select().from(termsVersions).where(eq(termsVersions.isCurrent, true));
  if (cur) return cur;
  const [t] = await app.ctx.db
    .insert(termsVersions)
    .values({ version: "1.0", title: "Termos de uso", body: "Texto dos termos de uso e confidencialidade para testes.", isCurrent: true })
    .returning();
  return t!;
}

interface InjectOpts {
  headers?: Record<string, string>;
  payload?: unknown;
  rawBody?: Buffer;
  contentType?: string;
}

/** Cliente HTTP com cookie de sessão e token CSRF, como o navegador. */
export class Client {
  cookie: string | null = null;
  csrf: string | null = null;
  /** Cada cliente simula uma máquina diferente (limites por IP valem por cliente). */
  readonly ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

  constructor(private readonly app: FastifyInstance) {}

  async request(method: string, url: string, opts: InjectOpts = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && !["GET", "HEAD"].includes(method)) headers["x-csrf-token"] = this.csrf;
    if (opts.contentType) headers["content-type"] = opts.contentType;
    const res = await this.app.inject({
      method: method as never,
      url,
      remoteAddress: this.ip,
      headers,
      payload: opts.rawBody ?? (opts.payload === undefined ? undefined : (opts.payload as object)),
    });
    const setCookie = res.headers["set-cookie"];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    for (const c of list) {
      const [pair] = c.split(";");
      const [name, value] = pair!.split("=");
      if (name?.includes("lc_session")) {
        this.cookie = value ? `${name}=${value}` : null;
        if (!value || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c)) this.cookie = null;
      }
    }
    return res;
  }

  get(url: string) {
    return this.request("GET", url);
  }
  post(url: string, payload?: unknown) {
    return this.request("POST", url, { payload: payload ?? {} });
  }
  put(url: string, payload?: unknown) {
    return this.request("PUT", url, { payload: payload ?? {} });
  }
  patch(url: string, payload?: unknown) {
    return this.request("PATCH", url, { payload: payload ?? {} });
  }
  delete(url: string, payload?: unknown) {
    return this.request("DELETE", url, payload === undefined ? {} : { payload });
  }

  async refreshCsrf() {
    const me = await this.get("/api/auth/me");
    this.csrf = me.json().csrfToken ?? null;
    return me.json();
  }

  async login(user: TestUser) {
    const res = await this.post("/api/auth/login", { email: user.email, password: user.password });
    if (res.statusCode !== 200) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
    await this.refreshCsrf();
    if (res.json().status === "mfa_required" && user.totpSecret) {
      // Permite logins repetidos no mesmo intervalo de 30 s (a proteção contra reuso é testada à parte).
      await this.app.ctx.db.update(users).set({ mfaLastStep: null }).where(eq(users.id, user.id));
      const v = await this.post("/api/auth/mfa/verify", { code: generateTotp(user.totpSecret) });
      if (v.statusCode !== 200) throw new Error(`mfa falhou: ${v.statusCode} ${v.body}`);
      await this.refreshCsrf();
    }
    return res.json();
  }

  async acceptTerms() {
    const ob = await this.get("/api/onboarding");
    const terms = ob.json().terms;
    if (terms) await this.post("/api/onboarding/terms", { termsVersionId: terms.id, accepted: true });
  }

  async upload(url: string, file: { name: string; type: string; data: Buffer }, fields: Record<string, string> = {}) {
    const boundary = `----lifeclass${Date.now()}`;
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
    parts.push(file.data);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
    return this.request("POST", url, { rawBody: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` });
  }
}

export async function makePdf(pages = 3, title = "Apostila de Teste"): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${title} — Página ${i}`, { x: 50, y: 780, size: 16, font });
    const words = Array.from({ length: 60 }, (_, k) => `palavra${k}`).join(" ");
    p.drawText(words.slice(0, 90), { x: 50, y: 740, size: 10, font });
    p.drawText(words.slice(90, 180), { x: 50, y: 725, size: 10, font });
  }
  return Buffer.from(await doc.save());
}

/** Monta área → trilha → módulo → apostila publicada, usando a API como um administrador faria. */
export async function buildPublishedTrack(admin: Client, opts: { mode?: string; title?: string } = {}) {
  const area = (await admin.post("/api/admin/areas", { name: `Área ${Date.now()}${Math.random().toString(36).slice(2, 6)}` })).json();
  const track = (await admin.post("/api/admin/tracks", { areaId: area.id, title: opts.title ?? "Trilha de Teste", mode: opts.mode ?? "opcional" })).json();
  const mod = (await admin.post("/api/admin/modules", { trackId: track.id, title: "Módulo 1" })).json();
  const content = (await admin.post("/api/admin/contents", { moduleId: mod.id, type: "document", title: "Apostila 1" })).json();
  const up = await admin.upload(`/api/admin/contents/${content.id}/versions`, { name: "apostila.pdf", type: "application/pdf", data: await makePdf(3) }, { changeNotes: "Primeira versão" });
  if (up.statusCode !== 200) throw new Error(`upload falhou: ${up.statusCode} ${up.body}`);
  for (const [kind, id] of [
    ["contents", content.id],
    ["modules", mod.id],
    ["tracks", track.id],
  ] as const) {
    const r = await admin.post(`/api/admin/${kind}/${id}/status`, { status: "published" });
    if (r.statusCode !== 200) throw new Error(`publicar ${kind} falhou: ${r.statusCode} ${r.body}`);
  }
  return { area, track, module: mod, content };
}

export { generateTotp };
