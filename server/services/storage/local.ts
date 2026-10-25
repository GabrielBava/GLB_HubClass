import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { assertSafeKey, type StorageDriver } from "./index.js";

/** Disco local, fora da pasta pública. Adequado para desenvolvimento e servidores únicos. */
export class LocalStorage implements StorageDriver {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Caminho fora do armazenamento");
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = `${full}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(tmp, data, { mode: 0o600 });
    await rename(tmp, full);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
