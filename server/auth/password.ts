import { hash, verify } from "@node-rs/argon2";

// Parâmetros Argon2id recomendados pela OWASP (19 MiB, 2 iterações).
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

// Hash fixo usado quando o e-mail não existe, para o tempo de resposta não revelar contas.
let dummyHash: Promise<string> | null = null;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword("senha-ficticia-para-tempo-constante-1");
  return dummyHash.then((h) => verifyPassword(h, password)).then(() => false);
}

const COMMON = new Set([
  "senha123",
  "senha1234",
  "senha12345",
  "123456789a",
  "password1",
  "password123",
  "qwerty123",
  "abc12345",
  "abcd1234",
  "mudar123",
  "admin123",
  "lifeclass1",
  "lifeclass123",
  "brasil123",
  "123mudar",
  "iloveyou1",
]);

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Política de senha: mínimo configurável, letras e números, sem nome/e-mail,
 * sem datas ou sequências longas de dígitos e fora de uma lista de senhas comuns.
 * Retorna a lista de problemas (vazia = senha aceita).
 */
export function passwordProblems(password: string, opts: { minLength: number; name?: string; email?: string }): string[] {
  const problems: string[] = [];
  if (password.length < opts.minLength) problems.push(`Use pelo menos ${opts.minLength} caracteres.`);
  if (password.length > 128) problems.push("Use no máximo 128 caracteres.");
  if (!/[A-Za-zÀ-ÿ]/.test(password) || !/\d/.test(password)) problems.push("Combine letras e números.");
  const norm = normalize(password);
  const parts = [
    ...normalize(opts.name ?? "").split(/\s+/),
    ...normalize((opts.email ?? "").split("@")[0] ?? "").split(/[._\-+]/),
  ].filter((p) => p.length >= 4);
  if (parts.some((p) => norm.includes(p))) problems.push("Não use seu nome ou e-mail na senha.");
  if (/\d{6,}/.test(password) || /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(password)) problems.push("Não use datas ou sequências longas de números.");
  if (COMMON.has(norm) || /^(.)\1+$/.test(password)) problems.push("Esta senha é muito comum. Escolha outra.");
  return problems;
}
