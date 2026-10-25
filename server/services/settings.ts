import { eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, type AllSettings, type SettingsKey } from "../../shared/settings.js";
import type { DB } from "../db/client.js";
import { settings } from "../db/schema.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Mescla o valor salvo sobre o padrão (mantém chaves novas ao atualizar a aplicação). */
export function mergeDeep<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return (override === undefined ? base : (override as T));
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (!(k in base)) continue;
    const b = (base as Record<string, unknown>)[k];
    out[k] = isPlainObject(b) ? mergeDeep(b, v) : v;
  }
  return out as T;
}

const TTL_MS = 15_000;

export class SettingsService {
  private cache: { at: number; value: AllSettings } | null = null;

  constructor(private readonly db: DB) {}

  async all(): Promise<AllSettings> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.value;
    const rows = await this.db.select().from(settings);
    const value = structuredClone(DEFAULT_SETTINGS);
    for (const row of rows) {
      const key = row.key as SettingsKey;
      if (key in value) (value as unknown as Record<string, unknown>)[key] = mergeDeep(DEFAULT_SETTINGS[key], row.value);
    }
    this.cache = { at: Date.now(), value };
    return value;
  }

  async get<K extends SettingsKey>(key: K): Promise<AllSettings[K]> {
    return (await this.all())[key];
  }

  async set<K extends SettingsKey>(key: K, value: AllSettings[K], userId: string | null): Promise<AllSettings[K]> {
    const merged = mergeDeep(DEFAULT_SETTINGS[key], value);
    await this.db
      .insert(settings)
      .values({ key, value: merged as unknown as Record<string, unknown>, updatedBy: userId })
      .onConflictDoUpdate({ target: settings.key, set: { value: merged as unknown as Record<string, unknown>, updatedAt: new Date(), updatedBy: userId } });
    this.cache = null;
    return merged;
  }

  invalidate() {
    this.cache = null;
  }

  async raw(key: SettingsKey) {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key));
    return row ?? null;
  }
}
