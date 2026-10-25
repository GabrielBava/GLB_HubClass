import type { AppConfig } from "../../config.js";
import { LocalStorage } from "./local.js";
import { S3Storage } from "./s3.js";

/**
 * Armazenamento privado de arquivos. Nenhum driver expõe URLs públicas:
 * os arquivos só saem do servidor por rotas autenticadas que verificam permissão.
 */
export interface StorageDriver {
  readonly kind: "local" | "s3";
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export function assertSafeKey(key: string) {
  if (!/^[a-z0-9][a-z0-9/_.-]*$/i.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`Chave de armazenamento inválida: ${key}`);
  }
}

export function createStorage(config: AppConfig): StorageDriver {
  if (config.storage.driver === "s3") return new S3Storage(config.storage);
  return new LocalStorage(config.storage.dir);
}
