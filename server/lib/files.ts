import type { FastifyReply } from "fastify";
import type { StorageDriver } from "../services/storage/index.js";

/** Maior arquivo entregue pela própria função; na Vercel, as respostas têm limite de 4,5 MB. */
const INLINE_LIMIT = 4 * 1024 * 1024;
/** Validade do link assinado de download (só depois da verificação de permissão). */
const SIGNED_URL_SECONDS = 300;

type SignedStorage = StorageDriver & { signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> };

/**
 * Entrega um arquivo do armazenamento privado como download. Arquivos grandes no Vercel Blob saem
 * por um link assinado de poucos minutos para aquele único arquivo; os demais passam pela API.
 */
export async function sendStoredFile(
  reply: FastifyReply,
  storage: StorageDriver,
  file: { storageKey: string; mimeType: string; sizeBytes: number },
  contentDisposition: string,
) {
  if (file.sizeBytes > INLINE_LIMIT && "signedDownloadUrl" in storage) {
    const url = await (storage as SignedStorage).signedDownloadUrl(file.storageKey, SIGNED_URL_SECONDS);
    return reply.header("Cache-Control", "no-store").redirect(url, 303);
  }
  const data = await storage.get(file.storageKey);
  reply.header("Content-Type", file.mimeType).header("Content-Disposition", contentDisposition).header("X-Content-Type-Options", "nosniff");
  return reply.send(data);
}
