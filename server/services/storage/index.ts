import type { AppConfig } from "../../config.js";
import { LocalStorage } from "./local.js";
import { S3Storage } from "./s3.js";
import { VercelBlobStorage } from "./vercel-blob.js";

/**
 * Armazenamento privado de arquivos. Nenhum driver expõe URLs públicas:
 * os arquivos só saem por rotas autenticadas que verificam permissão (no Vercel Blob,
 * arquivos grandes saem por link assinado de poucos minutos, emitido por essas mesmas rotas).
 */
export interface StorageDriver {
  readonly kind: "local" | "s3" | "vercel-blob";
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
  if (config.storage.driver === "vercel-blob") return new VercelBlobStorage();
  if (config.storage.driver === "s3") return new S3Storage(config.storage);
  return new LocalStorage(config.storage.dir);
}
