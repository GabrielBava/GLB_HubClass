import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3001),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  EXTRA_ORIGINS: z.string().default(""),
  DATABASE_URL: z.string().optional(),
  DATA_DIR: z.string().default("./data"),
  APP_SECRET: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3", "vercel-blob"]).optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(false),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: bool(false),
  MAIL_FROM: z.string().default("LIFE CLASS <nao-responda@exemplo.com.br>"),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  SOFFICE_PATH: z.string().default("soffice"),
  DOCX_CONVERSION: bool(true),
  TRUST_PROXY: bool(false),
  COOKIE_SECURE: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  ALLOW_EMBEDDED_DB_IN_PRODUCTION: bool(false),
  /** Variáveis definidas pela própria Vercel. */
  VERCEL: z.string().optional(),
  VERCEL_ENV: z.string().optional(),
  VERCEL_URL: z.string().optional(),
  VERCEL_BRANCH_URL: z.string().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  /** Segredo que a Vercel envia no cabeçalho Authorization das rotinas agendadas. */
  CRON_SECRET: z.string().optional(),
  /** Libera a configuração inicial (primeiro administrador) enquanto não houver administrador. */
  SETUP_TOKEN: z.string().optional(),
});

export interface AppConfig {
  env: "development" | "production" | "test";
  host: string;
  port: number;
  appOrigin: string;
  allowedOrigins: string[];
  databaseUrl: string | null;
  /** Diretório do banco embutido (PGlite) quando DATABASE_URL não é informado; ":memory:" em testes. */
  embeddedDbDir: string;
  dataDir: string;
  appSecret: string;
  storage:
    | { driver: "local"; dir: string }
    | {
        driver: "s3";
        bucket: string;
        region: string;
        endpoint?: string;
        accessKeyId?: string;
        secretAccessKey?: string;
        forcePathStyle: boolean;
      }
    | { driver: "vercel-blob" };
  smtp: { host: string; port: number; user?: string; pass?: string; secure: boolean } | null;
  mailFrom: string;
  clamav: { host: string; port: number } | null;
  docx: { enabled: boolean; sofficePath: string };
  trustProxy: boolean;
  cookieSecure: boolean;
  logLevel: string;
  /** Em testes e na Vercel, processa documentos dentro da própria requisição de envio. */
  processDocumentsInline: boolean;
  /** Execução em funções sem servidor (Vercel): sem tarefas em segundo plano nem arquivos estáticos. */
  serverless: boolean;
  cronSecret: string | null;
  setupToken: string | null;
}

function devSecret(dataDir: string): string {
  // Em desenvolvimento, gera um segredo aleatório e guarda fora do Git (data/).
  const file = path.join(dataDir, ".app-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(48).toString("base64url");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Arquivo .env opcional na raiz (variáveis já definidas no ambiente têm prioridade).
  if (env === process.env && env.NODE_ENV !== "test" && existsSync(".env")) process.loadEnvFile(".env");
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${issues}`);
  }
  const e = parsed.data;
  const serverless = !!e.VERCEL;
  // Na Vercel o ambiente de produção e as prévias rodam como produção (HTTPS, banco gerenciado).
  const production = e.NODE_ENV === "production" || serverless;
  const dataDir = path.resolve(e.DATA_DIR);

  // Em produção, aponta de uma vez tudo o que falta (na Vercel, cada ajuste exige um novo deploy).
  const missing: string[] = [];
  if (production && !e.APP_SECRET) missing.push("APP_SECRET (segredo aleatório de pelo menos 32 caracteres)");
  if (production && !e.DATABASE_URL && (serverless || !e.ALLOW_EMBEDDED_DB_IN_PRODUCTION)) {
    missing.push(serverless ? "DATABASE_URL (conecte o banco Neon ao projeto em Storage)" : "DATABASE_URL (PostgreSQL)");
  }
  if (missing.length) throw new Error(`Faltam variáveis de ambiente obrigatórias: ${missing.join("; ")}.`);

  const appSecret = e.APP_SECRET || devSecret(dataDir);
  if (appSecret.length < 32) throw new Error("APP_SECRET deve ter pelo menos 32 caracteres.");

  let storage: AppConfig["storage"];
  const driver = e.STORAGE_DRIVER ?? (serverless ? "vercel-blob" : "local");
  if (driver === "vercel-blob") {
    storage = { driver: "vercel-blob" };
  } else if (driver === "s3") {
    if (!e.S3_BUCKET) throw new Error("S3_BUCKET é obrigatório quando STORAGE_DRIVER=s3.");
    storage = {
      driver: "s3",
      bucket: e.S3_BUCKET,
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    };
  } else {
    storage = { driver: "local", dir: path.join(dataDir, "storage") };
  }

  // Na Vercel, sem APP_ORIGIN, vale o domínio de produção do projeto; as URLs da implantação
  // (prévias e domínio da branch) também são aceitas como origem.
  const vercelHost = (h?: string) => (h ? `https://${h.replace(/^https?:\/\//, "")}` : null);
  const appOriginRaw = env.APP_ORIGIN ? e.APP_ORIGIN : (vercelHost(e.VERCEL_PROJECT_PRODUCTION_URL) ?? vercelHost(e.VERCEL_URL) ?? e.APP_ORIGIN);
  const origin = new URL(appOriginRaw).origin;
  const extra = [...e.EXTRA_ORIGINS.split(","), ...(serverless ? [vercelHost(e.VERCEL_URL), vercelHost(e.VERCEL_BRANCH_URL)] : [])]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin)
    .filter((o, i, all) => o !== origin && all.indexOf(o) === i);

  return {
    env: serverless ? "production" : e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    appOrigin: origin,
    allowedOrigins: [origin, ...extra],
    databaseUrl: e.DATABASE_URL ?? null,
    embeddedDbDir: path.join(dataDir, "pglite"),
    dataDir,
    appSecret,
    storage,
    smtp: e.SMTP_HOST ? { host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS, secure: e.SMTP_SECURE } : null,
    mailFrom: e.MAIL_FROM,
    clamav: e.CLAMAV_HOST ? { host: e.CLAMAV_HOST, port: e.CLAMAV_PORT } : null,
    // Na Vercel não há LibreOffice: as apostilas entram em PDF (a conversão só liga se for configurada).
    docx: { enabled: serverless && env.DOCX_CONVERSION === undefined ? false : e.DOCX_CONVERSION, sofficePath: e.SOFFICE_PATH },
    trustProxy: e.TRUST_PROXY || serverless,
    cookieSecure: e.COOKIE_SECURE === undefined ? production : ["1", "true", "yes", "on"].includes(e.COOKIE_SECURE.toLowerCase()),
    logLevel: e.LOG_LEVEL,
    processDocumentsInline: serverless,
    serverless,
    cronSecret: e.CRON_SECRET && e.CRON_SECRET.length >= 16 ? e.CRON_SECRET : null,
    setupToken: e.SETUP_TOKEN && e.SETUP_TOKEN.length >= 16 ? e.SETUP_TOKEN : null,
  };
}
