// Modo demonstração (build estático, sem servidor).
// As respostas da API foram gravadas do servidor real, com dados fictícios, para cada perfil.
// Leituras são reproduzidas; alterações respondem sucesso, mas nada é gravado.

export type DemoRole = "collaborator" | "leader" | "admin";

export interface Recorded {
  /** Status HTTP */
  s: number;
  /** Content-Type */
  t: string;
  /** Corpo (texto ou base64) */
  b: string;
  base64?: boolean;
}

interface RoleData {
  email: string;
  name: string;
  get: Record<string, Recorded>;
  mut: Record<string, Recorded>;
}

export interface DemoData {
  recordedAt: string;
  roles: Record<DemoRole, RoleData>;
  shared: Record<string, Recorded>;
}

declare global {
  interface Window {
    __LC_DEMO__?: DemoData;
  }
}

export const DEMO_NOTICE = "lc:demo-notice";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// Gravações periódicas do leitor e do salvamento automático não geram aviso.
const SILENT = [/\/reading-sessions\//, /\/sessions$/, /\/events$/, /\/answers$/, /\/heartbeat/];

let role: DemoRole | null = null;
let data: DemoData | null = null;
// Apostila aberta no leitor: o pulso de leitura é simulado com as páginas lidas nesta visita.
let reading: { pageCount: number; pages: Set<number>; status: string } | null = null;

export const demoData = () => data;
export const demoRole = () => role;
export function setDemoRole(r: DemoRole | null) {
  role = r;
}

const normalize = (path: string) => path.replace(UUID, ":id");

function lookup(map: Record<string, Recorded>, url: URL): Recorded | undefined {
  const full = url.pathname + url.search;
  if (map[full]) return map[full];
  if (map[url.pathname]) return map[url.pathname];
  // Mesma rota com outros parâmetros (filtros, datas, sessão de leitura): usa a primeira gravação.
  const prefix = `${url.pathname}?`;
  const key = Object.keys(map).find((k) => k.startsWith(prefix));
  return key ? map[key] : undefined;
}

function toResponse(r: Recorded): Response {
  let body: BodyInit = r.b;
  if (r.base64) {
    const bin = atob(r.b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    body = new Blob([bytes], { type: r.t });
  }
  return new Response(r.s === 204 ? null : body, { status: r.s, headers: { "content-type": r.t } });
}

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const notice = (message: string) => window.dispatchEvent(new CustomEvent(DEMO_NOTICE, { detail: message }));

function dataUrl(r: Recorded) {
  return r.base64 ? `data:${r.t};base64,${r.b}` : `data:${r.t};charset=utf-8,${encodeURIComponent(r.b)}`;
}

async function readBody(body: BodyInit | null | undefined): Promise<Record<string, unknown>> {
  if (typeof body !== "string") return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handle(method: string, url: URL, body: BodyInit | null | undefined): Promise<Response> {
  const d = data!;
  const path = url.pathname;
  if (path === "/api/auth/login" && method === "POST") {
    const { email } = await readBody(body);
    const found = (Object.keys(d.roles) as DemoRole[]).find((r) => d.roles[r].email.toLowerCase() === String(email ?? "").trim().toLowerCase());
    if (!found) return json(401, { error: { code: "invalid_credentials", message: "Na demonstração, use os botões de perfil ou um dos e-mails fictícios listados." } });
    role = found;
    return json(200, { status: "ok" });
  }
  if ((path === "/api/auth/logout" || path === "/api/auth/logout-all") && method === "POST") {
    role = null;
    return json(200, { ok: true });
  }
  if (path === "/api/auth/me" && !role) return json(200, { authenticated: false });
  if (path.startsWith("/api/public/") || path === "/api/health") {
    const r = lookup(d.shared, url);
    return r ? toResponse(r) : json(404, { error: { code: "not_found", message: "Não encontrado." } });
  }
  if (!role) return json(401, { error: { code: "unauthenticated", message: "Escolha um perfil de demonstração." } });
  const rd = d.roles[role];

  if (method === "GET") {
    const r = lookup(rd.get, url) ?? lookup(d.shared, url);
    if (r && /^\/api\/contents\/[^/]+$/.test(path)) trackReading(r);
    if (r) return toResponse(r);
    return json(404, { error: { code: "not_found", message: "Esta tela não foi incluída na demonstração estática." } });
  }

  if (/^\/api\/reading-sessions\/[^/]+\/heartbeat$/.test(path) && reading) {
    const { pagesRead = [], page } = (await readBody(body)) as { pagesRead?: number[]; page?: number };
    pagesRead.forEach((p) => reading!.pages.add(p));
    const percent = reading.pageCount ? Math.round((reading.pages.size / reading.pageCount) * 100) : 0;
    if (percent >= 90) reading.status = "completed";
    return json(200, { status: reading.status, percent: reading.status === "completed" ? 100 : percent, pagesRead: [...reading.pages], lastPage: page ?? Math.max(1, ...reading.pages) });
  }
  const recorded = rd.mut[`${method} ${path}`] ?? rd.mut[`${method} ${normalize(path)}`];
  if (!SILENT.some((re) => re.test(path))) notice("Demonstração: a ação foi simulada e não é gravada.");
  if (recorded) return toResponse(recorded);
  return json(200, { ok: true, demo: true });
}

function trackReading(r: Recorded) {
  try {
    const c = JSON.parse(r.b) as { version?: { pageCount: number } | null; progress?: { pagesRead?: number[]; status?: string } | null };
    reading = c.version ? { pageCount: c.version.pageCount, pages: new Set(c.progress?.pagesRead ?? []), status: c.progress?.status ?? "in_progress" } : null;
  } catch {
    reading = null;
  }
}

/** Troca imagens servidas pela API (capas, logotipo, prévias) pelas gravações embutidas. */
function rewriteImages(root: ParentNode) {
  root.querySelectorAll?.<HTMLImageElement>('img[src^="/api/"]').forEach((img) => {
    const src = img.getAttribute("src")!;
    const r = role ? lookup(data!.roles[role].get, new URL(src, "http://demo.local")) : undefined;
    const s = r ?? lookup(data!.shared, new URL(src, "http://demo.local"));
    img.setAttribute("src", s ? dataUrl(s) : "data:image/gif;base64,R0lGODlhAQABAAAAACw=");
  });
}

export function installDemo(d: DemoData) {
  data = d;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!raw.startsWith("/api/")) return realFetch(input, init);
    const url = new URL(raw, "http://demo.local");
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    await new Promise((r) => setTimeout(r, 90));
    return handle(method, url, init?.body);
  };

  // Envio com keepalive (fim da sessão de leitura) também passa pelo fetch acima.
  const observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes" && m.target instanceof HTMLImageElement) rewriteImages(m.target.parentNode ?? document);
      m.addedNodes.forEach((n) => {
        if (n instanceof HTMLImageElement && n.getAttribute("src")?.startsWith("/api/")) rewriteImages(n.parentNode ?? document);
        else if (n instanceof Element) rewriteImages(n);
      });
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });

  // Downloads e exportações (links diretos para a API) não existem sem servidor.
  document.addEventListener(
    "click",
    (e) => {
      const a = (e.target as Element | null)?.closest?.("a[href^='/api/']");
      if (!a) return;
      e.preventDefault();
      notice("Demonstração: downloads e exportações CSV funcionam na aplicação instalada.");
    },
    true,
  );
}
