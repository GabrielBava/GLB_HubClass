import { randomUUID } from "node:crypto";
import { and, eq, inArray, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../../app.js";
import { contents, contentVersions, documentPages, files } from "../../db/schema.js";
import { HttpError } from "../../lib/errors.js";
import { sha256 } from "../../lib/crypto.js";
import { convertDocxToPdf, isDocx, isMacroEnabled } from "./docx.js";
import { scanBuffer } from "./malware.js";
import { closePdf, countWords, extractOutline, isPdf, openPdf, pageText, pdfRiskFlags, renderPage } from "./pdf.js";

export interface StoredFile {
  id: string;
  storageKey: string;
}

/** Valida, verifica (antivírus) e grava um arquivo no armazenamento privado. */
export async function storePrivateFile(
  ctx: AppContext,
  opts: { buffer: Buffer; originalName: string; mimeType: string; purpose: string; userId: string | null; extension: string },
): Promise<StoredFile & { scan: { status: string; detail: string } }> {
  const scan = await scanBuffer(opts.buffer, ctx.config.clamav);
  if (scan.status === "infected") throw new HttpError(422, "malware", "O arquivo foi bloqueado pela verificação antivírus.");
  if (scan.status === "error") throw new HttpError(503, "scan_failed", "Não foi possível verificar o arquivo agora. Tente novamente em instantes.");
  const key = `${opts.purpose}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${opts.extension}`;
  await ctx.storage.put(key, opts.buffer, opts.mimeType);
  const [row] = await ctx.db
    .insert(files)
    .values({
      storageKey: key,
      originalName: opts.originalName.slice(0, 250),
      mimeType: opts.mimeType,
      sizeBytes: opts.buffer.length,
      sha256: sha256(opts.buffer),
      purpose: opts.purpose,
      scanStatus: scan.status,
      scanDetail: scan.detail,
      uploadedBy: opts.userId,
    })
    .returning();
  return { id: row!.id, storageKey: key, scan };
}

/**
 * Recebe o arquivo de uma apostila (PDF ou DOCX), cria uma nova versão do conteúdo e agenda
 * o processamento (extração de texto e sumário, renderização das páginas).
 */
export async function ingestDocument(
  ctx: AppContext,
  opts: { buffer: Buffer; filename: string; contentId: string; userId: string; changeNotes: string; isMajor: boolean },
) {
  const security = await ctx.settings.get("security");
  if (opts.buffer.length === 0) throw new HttpError(400, "empty_file", "Arquivo vazio.");
  if (opts.buffer.length > security.maxUploadMb * 1024 * 1024) {
    throw new HttpError(413, "file_too_large", `O arquivo excede o limite de ${security.maxUploadMb} MB.`);
  }

  let pdfBuffer: Buffer;
  let sourceFile: StoredFile | null = null;
  if (isPdf(opts.buffer)) {
    pdfBuffer = opts.buffer;
  } else if (isDocx(opts.buffer)) {
    if (isMacroEnabled(opts.buffer)) throw new HttpError(415, "macro", "Documentos com macros não são aceitos.");
    if (!ctx.config.docx.enabled) throw new HttpError(415, "docx_disabled", "A conversão de DOCX não está habilitada neste servidor. Envie em PDF.");
    sourceFile = await storePrivateFile(ctx, {
      buffer: opts.buffer,
      originalName: opts.filename,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      purpose: "document-source",
      userId: opts.userId,
      extension: "docx",
    });
    try {
      pdfBuffer = await convertDocxToPdf(opts.buffer, ctx.config.docx.sofficePath);
    } catch {
      throw new HttpError(422, "conversion_failed", "Não foi possível converter o DOCX. Verifique o arquivo ou envie em PDF.");
    }
  } else {
    throw new HttpError(415, "unsupported", "Formato não aceito. Envie um arquivo PDF (ou DOCX, quando habilitado).");
  }

  // Validação de integridade: o PDF precisa abrir e ter ao menos uma página.
  try {
    const doc = await openPdf(pdfBuffer);
    const n = doc.numPages;
    await closePdf(doc);
    if (n < 1) throw new Error("sem páginas");
    if (n > 1500) throw new HttpError(413, "too_many_pages", "O documento tem páginas demais (limite de 1.500).");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(422, "invalid_pdf", "O PDF está corrompido, protegido por senha ou não pôde ser lido.");
  }

  const pdfName = opts.filename.replace(/\.docx$/i, ".pdf");
  const stored = await storePrivateFile(ctx, {
    buffer: pdfBuffer,
    originalName: pdfName,
    mimeType: "application/pdf",
    purpose: "document",
    userId: opts.userId,
    extension: "pdf",
  });
  const flags = pdfRiskFlags(pdfBuffer);
  if (flags.length) {
    await ctx.db.update(files).set({ scanDetail: `${stored.scan.detail} | Itens ativos no PDF: ${flags.join(", ")}` }).where(eq(files.id, stored.id));
  }

  const [{ value: last } = { value: 0 }] = await ctx.db
    .select({ value: max(contentVersions.versionNumber) })
    .from(contentVersions)
    .where(eq(contentVersions.contentId, opts.contentId));
  const [version] = await ctx.db
    .insert(contentVersions)
    .values({
      contentId: opts.contentId,
      versionNumber: (last ?? 0) + 1,
      fileId: stored.id,
      sourceFileId: sourceFile?.id ?? null,
      changeNotes: opts.changeNotes,
      isMajor: opts.isMajor,
      createdBy: opts.userId,
    })
    .returning();

  const job = ctx.jobs.enqueue(`process:${version!.id}`, () => processVersion(ctx, version!.id));
  if (ctx.config.processDocumentsInline) await job;
  return { version: version!, flags, scan: stored.scan };
}

/** Extrai texto, sumário e contagem de palavras e renderiza cada página em imagem privada. */
export async function processVersion(ctx: AppContext, versionId: string) {
  const { db, storage } = ctx;
  const [version] = await db.select().from(contentVersions).where(eq(contentVersions.id, versionId));
  if (!version || !version.fileId) return;
  const [file] = await db.select().from(files).where(eq(files.id, version.fileId));
  if (!file) return;
  await db.update(contentVersions).set({ processingStatus: "processing", processingError: null }).where(eq(contentVersions.id, versionId));
  try {
    const buf = await storage.get(file.storageKey);
    const doc = await openPdf(buf);
    const outline = await extractOutline(doc);
    let totalWords = 0;
    const firstLines: { title: string; page: number; level: number }[] = [];
    await db.delete(documentPages).where(eq(documentPages.versionId, versionId));
    for (let n = 1; n <= doc.numPages; n++) {
      const text = await pageText(doc, n);
      const words = countWords(text);
      totalWords += words;
      const { image, width, height } = await renderPage(doc, n);
      const imageKey = `pages/${versionId}/${String(n).padStart(4, "0")}.webp`;
      await storage.put(imageKey, image, "image/webp");
      await db.insert(documentPages).values({ versionId, pageNumber: n, imageKey, width, height, text, wordCount: words });
      const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 3);
      firstLines.push({ title: line ? line.slice(0, 80) : `Página ${n}`, page: n, level: 0 });
    }
    const pageCount = doc.numPages;
    await closePdf(doc);
    await db
      .update(contentVersions)
      .set({
        processingStatus: "ready",
        pageCount,
        wordCount: totalWords,
        outline: outline.length ? outline : firstLines,
      })
      .where(eq(contentVersions.id, versionId));

    // A primeira versão pronta vira a versão atual automaticamente; as demais aguardam publicação.
    const [content] = await db.select().from(contents).where(eq(contents.id, version.contentId));
    if (content && !content.currentVersionId) {
      await db
        .update(contents)
        .set({ currentVersionId: versionId, updatedAt: new Date() })
        .where(eq(contents.id, content.id));
      await db.update(contentVersions).set({ publishedAt: new Date() }).where(eq(contentVersions.id, versionId));
    }
  } catch (err) {
    await db
      .update(contentVersions)
      .set({ processingStatus: "failed", processingError: (err as Error).message.slice(0, 500) })
      .where(eq(contentVersions.id, versionId));
    throw err;
  }
}

export async function recoverPendingDocuments(app: FastifyInstance) {
  const { db } = app.ctx;
  const pending = await db
    .select({ id: contentVersions.id })
    .from(contentVersions)
    .where(inArray(contentVersions.processingStatus, ["pending", "processing"]));
  for (const v of pending) void app.ctx.jobs.enqueue(`process:${v.id}`, () => processVersion(app.ctx, v.id));
  if (pending.length) app.log.info(`${pending.length} documento(s) reenfileirado(s) para processamento`);
}

export async function versionPage(ctx: AppContext, versionId: string, page: number) {
  const [row] = await ctx.db
    .select()
    .from(documentPages)
    .where(and(eq(documentPages.versionId, versionId), eq(documentPages.pageNumber, page)));
  return row ?? null;
}
