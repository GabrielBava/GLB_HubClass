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
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
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
      };
  smtp: { host: string; port: number; user?: string; pass?: string; secure: boolean } | null;
  mailFrom: string;
  clamav: { host: string; port: number } | null;
  docx: { enabled: boolean; sofficePath: string };
  trustProxy: boolean;
  cookieSecure: boolean;
  logLevel: string;
  /** Em testes, processa documentos de forma síncrona. */
  processDocumentsInline: boolean;
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
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuração inválida: ${issues}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === "production";
  const dataDir = path.resolve(e.DATA_DIR);

  let appSecret = e.APP_SECRET;
  if (!appSecret) {
    if (production) throw new Error("APP_SECRET é obrigatório em produção (mínimo de 32 caracteres).");
    appSecret = devSecret(dataDir);
  }
  if (appSecret.length < 32) throw new Error("APP_SECRET deve ter pelo menos 32 caracteres.");

  if (production && !e.DATABASE_URL && !e.ALLOW_EMBEDDED_DB_IN_PRODUCTION) {
    throw new Error("DATABASE_URL (PostgreSQL) é obrigatório em produção.");
  }

  let storage: AppConfig["storage"];
  if (e.STORAGE_DRIVER === "s3") {
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

  const origin = new URL(e.APP_ORIGIN).origin;
  const extra = e.EXTRA_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => new URL(s).origin);

  return {
    env: e.NODE_ENV,
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
    docx: { enabled: e.DOCX_CONVERSION, sofficePath: e.SOFFICE_PATH },
    trustProxy: e.TRUST_PROXY,
    cookieSecure: e.COOKIE_SECURE === undefined ? production : ["1", "true", "yes", "on"].includes(e.COOKIE_SECURE.toLowerCase()),
    logLevel: e.LOG_LEVEL,
    processDocumentsInline: false,
  };
}
