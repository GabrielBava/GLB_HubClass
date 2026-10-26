import { createRequire } from "node:module";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

const require = createRequire(import.meta.url);
const pdfjsDir = path.dirname(require.resolve("pdfjs-dist/package.json"));
export const STANDARD_FONTS_DIR = path.join(pdfjsDir, "standard_fonts") + path.sep;
const CMAPS_DIR = path.join(pdfjsDir, "cmaps") + path.sep;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
function pdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}

export interface OutlineItem {
  title: string;
  page: number;
  level: number;
}

/** Marcadores que merecem atenção do administrador (o PDF original nunca é entregue ao navegador). */
export function pdfRiskFlags(buf: Buffer): string[] {
  const head = buf.toString("latin1");
  const flags: string[] = [];
  if (/\/JavaScript|\/JS\s*[(<]/.test(head)) flags.push("javascript");
  if (/\/Launch/.test(head)) flags.push("launch_action");
  if (/\/EmbeddedFile/.test(head)) flags.push("embedded_file");
  if (/\/RichMedia/.test(head)) flags.push("rich_media");
  return flags;
}

export function isPdf(buf: Buffer) {
  return buf.subarray(0, 1024).toString("latin1").includes("%PDF-");
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

export async function openPdf(buf: Buffer) {
  const lib = await pdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(buf),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS_DIR,
    cMapUrl: CMAPS_DIR,
    cMapPacked: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  return doc;
}

/** Libera os recursos do documento (o PDF.js mantém um worker por documento). */
export async function closePdf(doc: Awaited<ReturnType<typeof openPdf>>) {
  await doc.loadingTask.destroy();
}

type PdfDoc = Awaited<ReturnType<typeof openPdf>>;

export async function extractOutline(doc: PdfDoc): Promise<OutlineItem[]> {
  const out: OutlineItem[] = [];
  const outline = await doc.getOutline().catch(() => null);
  if (!outline) return out;
  async function walk(items: NonNullable<typeof outline>, level: number) {
    for (const item of items) {
      if (out.length >= 300) return;
      let page = 0;
      try {
        let dest = item.dest;
        if (typeof dest === "string") dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          const ref = dest[0];
          page = typeof ref === "number" ? ref + 1 : (await doc.getPageIndex(ref as never)) + 1;
        }
      } catch {
        page = 0;
      }
      const title = String(item.title ?? "").trim().slice(0, 200);
      if (title && page > 0) out.push({ title, page, level });
      if (item.items?.length && level < 3) await walk(item.items, level + 1);
    }
  }
  await walk(outline, 0);
  return out;
}

/**
 * Texto da página e o provável título (linha com a maior fonte, bem acima da mediana).
 * O título alimenta o sumário quando o PDF não tem marcadores próprios.
 */
export async function pageContent(doc: PdfDoc, pageNumber: number): Promise<{ text: string; heading: string | null }> {
  const page = await doc.getPage(pageNumber);
  const tc = await page.getTextContent();
  let text = "";
  const lines = new Map<string, { size: number; y: number; str: string }>();
  const sizes: number[] = [];
  for (const item of tc.items) {
    if (!("str" in item)) continue;
    text += item.str;
    text += item.hasEOL ? "\n" : " ";
    if (!item.str.trim()) continue;
    const size = Math.round(Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) * 10) / 10 || item.height;
    const y = Math.round(item.transform[5] ?? 0);
    sizes.push(size);
    const key = `${y}:${size}`;
    const line = lines.get(key) ?? { size, y, str: "" };
    line.str += item.str;
    lines.set(key, line);
  }
  page.cleanup();
  const sorted = [...sizes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const candidates = [...lines.values()].filter((l) => l.size >= median * 1.3 && l.str.trim().length >= 3);
  candidates.sort((a, b) => b.size - a.size || b.y - a.y);
  let heading: string | null = null;
  const top = candidates[0];
  if (top) {
    // Títulos longos quebram em várias linhas do mesmo tamanho: junta as linhas logo abaixo.
    const parts = [top.str];
    let y = top.y;
    for (const l of candidates.filter((c) => c.size === top.size && c.y < top.y).sort((a, b) => b.y - a.y)) {
      if (y - l.y > top.size * 1.8) break;
      parts.push(l.str);
      y = l.y;
    }
    heading = parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return { text: text.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim(), heading };
}

export async function pageText(doc: PdfDoc, pageNumber: number): Promise<string> {
  return (await pageContent(doc, pageNumber)).text;
}

/** Renderiza a página como imagem WebP (largura alvo ~1600 px, boa para zoom em telas comuns). */
export async function renderPage(doc: PdfDoc, pageNumber: number, targetWidth = 1600) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1, targetWidth / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas: canvas as never, viewport }).promise;
  const image = await canvas.encode("webp", 82);
  page.cleanup();
  return { image, width: canvas.width, height: canvas.height };
}
