// Grava as respostas da API do servidor real (com os dados fictícios do seed) para a demonstração estática.
// Pré-requisitos: `npm run seed`, servidor rodando (padrão http://localhost:3001) e Playwright disponível.
// Uso: node tools/demo/record.cjs [saída.json]
const fs = require("fs");
const path = require("path");
const { authenticator } = require("otplib");

function loadPlaywright() {
  for (const id of ["playwright", "/opt/node-tools/node_modules/playwright"]) {
    try {
      return require(id);
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error("Playwright não encontrado. Instale com: npm i -D playwright && npx playwright install chromium");
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, "../..");
const BASE = process.env.BASE ?? "http://localhost:3001";
const OUT = path.resolve(process.argv[2] ?? path.join(ROOT, "dist/demo-data.json"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Respostas de escrita que podem ser reutilizadas para qualquer identificador (sessões de leitura e eventos).
const GENERIC_MUTATIONS = [/\/api\/contents\/[^/]+\/sessions$/, /\/api\/reading-sessions\//, /\/events$/, /\/answers$/];

const creds = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, "data/demo-credentials.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length === 3 && p[1].includes("@"))
    .map(([, email, pass]) => [email, pass]),
);

const PROFILES = {
  collaborator: "ana.souza@exemplo.com.br",
  leader: "renata.lider@exemplo.com.br",
  admin: "admin.demo@exemplo.com.br",
};

const out = { recordedAt: new Date().toISOString(), roles: {}, shared: {} };
// Chaves de MFA dos perfis fictícios ficam em data/ (fora do Git) para permitir novas gravações.
const SECRETS = path.join(ROOT, "data/.demo-mfa.json");
const secrets = fs.existsSync(SECRETS) ? JSON.parse(fs.readFileSync(SECRETS, "utf8")) : {};

async function freshCode(email, state) {
  for (;;) {
    const step = Math.floor(Date.now() / 30000);
    if (state.step !== step) {
      state.step = step;
      return authenticator.generate(secrets[email]);
    }
    await sleep(1000);
  }
}

async function login(page, email) {
  const state = {};
  await page.goto(`${BASE}/entrar`);
  await page.fill("#email", email);
  await page.fill("#password", creds[email]);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.endsWith("/entrar"), { timeout: 15000 });
  await sleep(400);
  if (page.url().includes("/entrar/configurar-mfa")) {
    const code = page.locator("code.select-all");
    await code.waitFor();
    secrets[email] = (await code.textContent()).trim();
    fs.writeFileSync(SECRETS, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    await page.fill("#code", await freshCode(email, state));
    await page.click('button[type="submit"]');
    await page.getByText("Guardei os códigos em local seguro").click();
    await page.getByRole("button", { name: "Continuar" }).click();
  } else if (page.url().includes("/entrar/verificacao")) {
    await page.fill("#code", await freshCode(email, state));
    await page.click('button[type="submit"]');
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/entrar"), { timeout: 15000 });
  await sleep(300);
  if (page.url().includes("/primeiro-acesso")) {
    for (let step = 0; step < 4; step++) {
      if (step === 2) {
        const reg = page.getByRole("button", { name: "Registrar ciência" });
        if (await reg.isVisible().catch(() => false)) {
          await page.getByText("Li e estou ciente").click();
          await reg.click();
          await page.getByText("Ciência registrada").first().waitFor();
        }
      }
      await page.getByRole("button", { name: "Avançar" }).click();
    }
    await page.getByRole("button", { name: "Iniciar minha capacitação" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/primeiro-acesso"));
  }
}

function recorder(page, store) {
  const pending = [];
  page.on("response", (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith("/api/") || res.status() === 401) return;
    const method = res.request().method();
    pending.push(
      (async () => {
        const t = res.headers()["content-type"] ?? "application/json";
        if (t.includes("text/csv") || t.includes("application/pdf")) return;
        let body;
        try {
          body = await res.body();
        } catch {
          return;
        }
        const binary = /^image\//.test(t);
        const rec = { s: res.status(), t, b: binary ? body.toString("base64") : body.toString("utf8"), ...(binary ? { base64: true } : {}) };
        // Imagens de página: o parâmetro da sessão de leitura não muda o conteúdo gravado.
        const key = binary ? url.pathname : url.pathname + url.search;
        if (method === "GET") {
          const target = url.pathname.startsWith("/api/public/") ? out.shared : store.get;
          // Uma falha posterior não substitui uma resposta bem-sucedida.
          if (target[key] && target[key].s < 400 && rec.s >= 400) return;
          if (url.pathname === "/api/auth/me" && rec.b.includes('"authenticated":false')) return;
          target[key] = rec;
        } else {
          store.mut[`${method} ${url.pathname}`] = rec;
          if (GENERIC_MUTATIONS.some((re) => re.test(url.pathname))) store.mut[`${method} ${url.pathname.replace(UUID, ":id")}`] = rec;
        }
      })(),
    );
  });
  return () => Promise.all(pending);
}

const api = (page, url) => page.evaluate((u) => fetch(u, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)), url);
const fetchAll = (page, urls) => page.evaluate((list) => Promise.all(list.map((u) => fetch(u, { credentials: "same-origin" }).then((r) => r.arrayBuffer()).catch(() => null))).then(() => true), urls);

async function visit(page, p) {
  await page.goto(`${BASE}${p}`);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await sleep(150);
}

async function clickTabs(page, names) {
  for (const name of names) {
    const tab = page.getByRole("tab", { name });
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await sleep(150);
    }
  }
}

/** Páginas de aprendizagem: trilhas, módulos, apostilas (todas as páginas), avaliações e atividades. */
async function crawlLearning(page, { startAttempts }) {
  for (const p of ["/", "/areas", "/trilhas", "/anotacoes", "/minha-evolucao", "/biblioteca", "/notificacoes", "/ajuda", "/perfil", "/primeiro-acesso"]) await visit(page, p);
  const catalog = await api(page, "/api/catalog/tracks");
  for (const t of catalog?.tracks ?? []) {
    await visit(page, `/trilhas/${t.id}`);
    const detail = await api(page, `/api/tracks/${t.id}`);
    if (!detail || detail.locked) continue;
    const view = detail.view;
    for (const m of view.modules) {
      if (m.locked) continue;
      await visit(page, `/modulos/${m.id}`);
      for (const c of m.contents) {
        if (c.locked) continue;
        await visit(page, `/conteudos/${c.id}`);
        if (c.type === "document" && c.pageCount > 0) {
          // Todas as páginas (imagens com a marca d'água deste perfil) e o texto do modo acessível.
          const pages = Array.from({ length: c.pageCount }, (_, i) => i + 1);
          await fetchAll(page, pages.map((n) => `/api/contents/${c.id}/pages/${n}/image`));
          await fetchAll(page, pages.map((n) => `/api/contents/${c.id}/pages/${n}/text`));
        }
      }
      for (const a of m.assessments) await visitAssessment(page, a, startAttempts);
      for (const act of m.activities) await visit(page, `/atividades/${act.id}`);
    }
    for (const a of view.finalAssessments ?? []) await visitAssessment(page, a, startAttempts);
  }
  for (const c of (await api(page, "/api/me/progress"))?.certificates ?? []) await visit(page, `/certificados/${c.code}`);
}

async function visitAssessment(page, a, startAttempts) {
  await visit(page, `/avaliacoes/${a.id}`);
  if (!startAttempts || a.locked) return;
  const start = page.getByRole("button", { name: /Iniciar|Nova tentativa|Continuar tentativa/ });
  if (await start.first().isVisible().catch(() => false)) {
    await start.first().click();
    await page.waitForURL(/tentativas/, { timeout: 8000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await sleep(300);
  }
}

async function crawlLeader(page) {
  for (const p of ["/lider", "/lider/validacoes", "/lider/solicitacoes", "/lider/duvidas"]) await visit(page, p);
  const overview = await api(page, "/api/leader/overview");
  for (const m of overview?.members ?? []) await visit(page, `/lider/equipe/${m.id}`);
  const validations = await api(page, "/api/leader/validations");
  const attempts = validations?.attempts ?? [];
  for (const a of attempts) await visit(page, `/lider/validacoes/tentativas/${a.id}`);
}

async function crawlContentAdmin(page, { isAdmin }) {
  await visit(page, "/admin/conteudos");
  const tree = (await api(page, "/api/admin/content/tree")) ?? [];
  for (const area of tree) {
    for (const t of area.tracks) {
      await visit(page, `/admin/trilhas/${t.id}`);
      const ed = await api(page, `/api/admin/tracks/${t.id}`);
      if (!ed) continue;
      for (const m of ed.modules) {
        for (const c of m.contents) await visit(page, `/admin/conteudos/${c.id}`);
        for (const a of m.assessments) {
          await visit(page, `/admin/avaliacoes/${a.id}`);
          await visit(page, `/admin/avaliacoes/${a.id}/resultados`);
        }
      }
      for (const a of ed.finalAssessments) {
        await visit(page, `/admin/avaliacoes/${a.id}`);
        await visit(page, `/admin/avaliacoes/${a.id}/resultados`);
      }
    }
  }
  await visit(page, "/admin/questoes");
  if (!isAdmin) return;
}

async function crawlAdmin(page) {
  await visit(page, "/admin");
  await visit(page, "/admin/usuarios");
  const users = (await api(page, "/api/admin/users")) ?? [];
  for (const u of users.items ?? users) {
    await visit(page, `/admin/usuarios/${u.id}`);
    await fetchAll(page, [`/api/admin/access/user/${u.id}`]);
  }
  await visit(page, "/admin/organizacao");
  await visit(page, "/admin/permissoes");
  await clickTabs(page, ["Atribuição em massa", "Verificar acesso"]);
  for (const p of ["/admin/relatorios", "/admin/auditoria", "/admin/biblioteca"]) await visit(page, p);
  await visit(page, "/admin/seguranca");
  await clickTabs(page, ["Sessões ativas", "Termos de uso", "Privacidade e retenção"]);
  await visit(page, "/admin/configuracoes");
}

async function recordProfile(browser, role, crawl) {
  const email = PROFILES[role];
  const store = { email, name: "", get: {}, mut: {} };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await ctx.newPage();
  const flush = recorder(page, store);
  await login(page, email);
  await crawl(page);
  const me = await api(page, "/api/auth/me");
  store.name = me?.user?.name ?? email;
  await sleep(500);
  await flush();
  await ctx.close();
  out.roles[role] = store;
  console.log(`${role}: ${Object.keys(store.get).length} leituras, ${Object.keys(store.mut).length} escritas`);
}

(async () => {
  const browser = await chromium.launch();
  await recordProfile(browser, "collaborator", (page) => crawlLearning(page, { startAttempts: true }));
  await recordProfile(browser, "leader", async (page) => {
    await crawlLeader(page);
    await crawlLearning(page, { startAttempts: false });
    await crawlContentAdmin(page, { isAdmin: false });
  });
  await recordProfile(browser, "admin", async (page) => {
    await crawlAdmin(page);
    await crawlContentAdmin(page, { isAdmin: true });
    await crawlLeader(page);
    await crawlLearning(page, { startAttempts: false });
  });
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`Gravado em ${OUT} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
