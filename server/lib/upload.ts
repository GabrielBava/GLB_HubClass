import type { FastifyRequest } from "fastify";
import { badRequest, HttpError } from "./errors.js";

export interface UploadedFile {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  fields: Record<string, string>;
}

/** Lê um único arquivo multipart (os campos de texto devem vir antes do arquivo). */
export async function readSingleFile(req: FastifyRequest, maxBytes: number): Promise<UploadedFile> {
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

export function detectImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { mime: "image/png", ext: "png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}
