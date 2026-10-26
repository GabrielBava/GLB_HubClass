import type { FastifyRequest } from "fastify";
import { badRequest, HttpError } from "./errors.js";

export interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  fields: Record<string, string>;
}

/** Prefixo dos envios diretos de cada pessoa (Vercel Blob); só ela pode confirmar o que enviou. */
export function directUploadPrefix(userId: string) {
  return `uploads/tmp/${userId}/`;
}

const DIRECT_UPLOAD_NAME = /^[0-9a-f-]{36}$/;

/**
 * Lê um único arquivo: multipart (os campos de texto devem vir antes do arquivo) ou, no Vercel Blob,
 * a confirmação de um envio direto `{ blobUpload: { pathname, filename, contentType, fields } }`.
 * O envio direto é lido do armazenamento privado, passa pelas mesmas validações e é apagado em seguida.
 */
export async function readSingleFile(req: FastifyRequest, maxBytes: number): Promise<UploadedFile> {
  const direct = (req.body as { blobUpload?: unknown } | undefined)?.blobUpload;
  if (direct !== undefined) return readDirectUpload(req, direct, maxBytes);
  if (!req.isMultipart()) throw badRequest("Envie o arquivo como multipart/form-data.");
  const part = await req.file({ limits: { fileSize: maxBytes, files: 1 } });
  if (!part) throw badRequest("Nenhum arquivo recebido.");
  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch {
    throw new HttpError(413, "file_too_large", `Arquivo maior que o limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(part.fields)) {
    const f = Array.isArray(v) ? v[0] : v;
    if (f && "value" in f && typeof f.value === "string") fields[k] = f.value;
  }
  return { buffer, filename: part.filename.slice(0, 200), mimetype: part.mimetype, fields };
}

async function readDirectUpload(req: FastifyRequest, raw: unknown, maxBytes: number): Promise<UploadedFile> {
  const { storage } = req.server.ctx;
  if (storage.kind !== "vercel-blob" || !req.auth) throw badRequest("Envio direto indisponível neste ambiente.");
  const info = raw as { pathname?: unknown; filename?: unknown; contentType?: unknown; fields?: unknown };
  const prefix = directUploadPrefix(req.auth.user.id);
  const pathname = typeof info.pathname === "string" ? info.pathname : "";
  if (!pathname.startsWith(prefix) || !DIRECT_UPLOAD_NAME.test(pathname.slice(prefix.length))) throw badRequest("Envio inválido.");
  let buffer: Buffer;
  try {
    buffer = await storage.get(pathname);
  } catch {
    throw badRequest("O arquivo enviado não foi encontrado. Envie novamente.");
  }
  // O arquivo temporário sai do armazenamento em qualquer caso; o definitivo é gravado pela rota.
  await storage.delete(pathname).catch(() => {});
  if (buffer.length > maxBytes) throw new HttpError(413, "file_too_large", `Arquivo maior que o limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const fields: Record<string, string> = {};
  if (info.fields && typeof info.fields === "object") {
    for (const [k, v] of Object.entries(info.fields as Record<string, unknown>).slice(0, 30)) if (typeof v === "string") fields[k] = v.slice(0, 100_000);
  }
  const filename = (typeof info.filename === "string" && info.filename ? info.filename : "arquivo").slice(0, 200);
  const mimetype = typeof info.contentType === "string" && info.contentType ? info.contentType.slice(0, 120) : "application/octet-stream";
  return { buffer, filename, mimetype, fields };
}

const OOXML: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * Materiais da biblioteca: PDF, Word, Excel, PowerPoint (sem macros) e EPUB.
 * O tipo é confirmado pelo conteúdo do arquivo, não só pela extensão.
 */
export function detectLibraryFile(buf: Buffer, filename: string): { mime: string; ext: string } | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (buf.subarray(0, 1024).toString("latin1").includes("%PDF-")) return { mime: "application/pdf", ext: "pdf" };
  const isZip = buf.length > 4 && buf.readUInt32BE(0) === 0x504b0304;
  if (!isZip) return null;
  if (ext === "epub" && buf.subarray(0, 100).toString("latin1").includes("application/epub+zip")) return { mime: "application/epub+zip", ext };
  if (OOXML[ext] && buf.includes("[Content_Types].xml")) return { mime: OOXML[ext], ext };
  return null;
}

export function detectImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { mime: "image/png", ext: "png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}
