import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema.js";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface Database {
  db: DB;
  kind: "postgres" | "embedded";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

function migrationsFolder(): string {
  const local = fileURLToPath(new URL("./migrations", import.meta.url));
  if (existsSync(local)) return local;
  return path.resolve(process.cwd(), "server/db/migrations");
}

/**
 * Abre o banco de dados.
 * - Com DATABASE_URL: PostgreSQL (produção).
 * - Sem DATABASE_URL: PostgreSQL embutido (PGlite) em data/pglite, para desenvolvimento
 *   e testes sem instalar nada. ":memory:" cria um banco temporário em memória.
 */
export async function openDatabase(opts: { databaseUrl: string | null; embeddedDir: string }): Promise<Database> {
  if (opts.databaseUrl) {
    const pg = (await import("pg")).default;
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema }) as unknown as DB;
    return {
      db,
      kind: "postgres",
      migrate: () => migrate(db as never, { migrationsFolder: migrationsFolder() }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  let client;
  if (opts.embeddedDir === ":memory:") {
    client = new PGlite();
  } else {
    mkdirSync(opts.embeddedDir, { recursive: true });
    client = new PGlite(opts.embeddedDir);
  }
  const db = drizzle(client, { schema }) as unknown as DB;
  return {
    db,
    kind: "embedded",
    migrate: () => migrate(db as never, { migrationsFolder: migrationsFolder() }),
    close: () => client.close(),
  };
}
