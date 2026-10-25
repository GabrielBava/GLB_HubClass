// Cliente HTTP da aplicação. A sessão fica em cookie HttpOnly (inacessível ao JavaScript);
// o token CSRF da sessão é mantido apenas em memória e enviado nas requisições que alteram dados.

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function request<T>(method: string, url: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (UNSAFE.has(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const res = await fetch(url, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("application/json") ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; details?: { path: string; message: string }[] } } | null)?.error;
    const code = err?.code ?? "error";
    if (res.status === 403 && code === "csrf" && !retried) {
      // A sessão foi trocada (ex.: após o MFA): atualiza o token e tenta de novo uma vez.
      const me = await request<{ csrfToken?: string }>("GET", "/api/auth/me");
      setCsrfToken(me.csrfToken ?? null);
      return request<T>(method, url, body, true);
    }
    if (res.status === 401 && !url.startsWith("/api/auth/")) window.dispatchEvent(new CustomEvent("lc:unauthorized"));
    if (res.status === 403 && code === "mfa_required") window.dispatchEvent(new CustomEvent("lc:mfa-required"));
    if (res.status === 403 && code === "terms_required") window.dispatchEvent(new CustomEvent("lc:terms-required"));
    throw new ApiError(res.status, code, err?.message ?? "Não foi possível concluir a operação.", err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body: unknown = {}) => request<T>("POST", url, body),
  put: <T>(url: string, body: unknown = {}) => request<T>("PUT", url, body),
  patch: <T>(url: string, body: unknown = {}) => request<T>("PATCH", url, body),
  del: <T>(url: string, body?: unknown) => request<T>("DELETE", url, body),
  upload: <T>(url: string, form: FormData) => request<T>("POST", url, form),
};

/** Envio "fire and forget" que sobrevive ao fechamento da aba (fim da sessão de leitura). */
export function postKeepalive(url: string, body: unknown) {
  try {
    void fetch(url, {
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    /* ignorado */
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return "Falha de conexão. Verifique sua internet e tente novamente.";
  return "Erro inesperado.";
}

/** Só aceita caminhos internos (evita redirecionamento aberto após o login). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}
