import { BlobNotFoundError, del, get, head, issueSignedToken, list, presignUrl, put } from "@vercel/blob";
import { assertSafeKey, type StorageDriver } from "./index.js";

/**
 * Vercel Blob em modo privado: toda leitura e escrita exige credencial (OIDC do projeto na Vercel
 * ou BLOB_READ_WRITE_TOKEN). Não há URL pública: arquivos grandes saem por link assinado de
 * curta duração, emitido só depois da verificação de permissão, e chegam por envio direto
 * com link assinado de uso único (o limite de 4,5 MB por requisição das funções não se aplica).
 */
export class VercelBlobStorage implements StorageDriver {
  readonly kind = "vercel-blob" as const;
  readonly directUploads = true;

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertSafeKey(key);
    await put(key, data, { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true });
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const res = await get(key, { access: "private" });
    if (!res || res.statusCode !== 200) throw new Error(`Arquivo não encontrado no armazenamento: ${key}`);
    return Buffer.from(await new Response(res.stream).arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await del(key);
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await head(key);
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }

  /** Link de leitura assinado para um único arquivo, válido por poucos minutos. */
  async signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    assertSafeKey(key);
    const validUntil = Date.now() + ttlSeconds * 1000;
    const token = await issueSignedToken({ pathname: key, operations: ["get"], validUntil });
    const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: key, access: "private", validUntil });
    return presignedUrl;
  }

  /** Autorização de envio direto pelo navegador: um único caminho, tamanho máximo e prazo curto. */
  async signedUploadToken(key: string, maxBytes: number, ttlSeconds: number) {
    assertSafeKey(key);
    const validUntil = Date.now() + ttlSeconds * 1000;
    const token = await issueSignedToken({ pathname: key, operations: ["put"], validUntil, maximumSizeInBytes: maxBytes });
    return { token, validUntil };
  }

  /** Remove envios temporários abandonados (que nunca foram confirmados). */
  async deleteOlderThan(prefix: string, before: Date): Promise<number> {
    let cursor: string | undefined;
    let removed = 0;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      const stale = page.blobs.filter((b) => b.uploadedAt < before).map((b) => b.pathname);
      if (stale.length) await del(stale);
      removed += stale.length;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return removed;
  }
}
