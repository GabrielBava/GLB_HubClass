import path from "node:path";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { STANDARD_FONTS_DIR } from "./pdf.js";

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  // Fonte embarcada (Liberation Sans, licença OFL) para não depender de fontes do sistema.
  GlobalFonts.registerFromPath(path.join(STANDARD_FONTS_DIR, "LiberationSans-Regular.ttf"), "LCWatermark");
  fontReady = true;
}

export interface WatermarkInfo {
  name: string;
  code: string;
  date: string;
  session: string;
}

/**
 * Aplica a marca d'água individual sobre a imagem da página: texto diagonal repetido e discreto
 * (nome, identificador interno e data da sessão) e uma faixa de rodapé com os mesmos dados.
 * A marca é gravada nos pixels: capturas de tela continuam rastreáveis.
 */
export async function applyWatermark(image: Buffer, info: WatermarkInfo): Promise<Buffer> {
  ensureFont();
  const img = await loadImage(image);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const fontSize = Math.max(18, Math.round(img.width / 48));
  const label = `${info.name} · ${info.code} · ${info.date}`;
  ctx.save();
  ctx.font = `${fontSize}px LCWatermark`;
  ctx.fillStyle = "rgba(20, 30, 40, 0.085)";
  ctx.translate(img.width / 2, img.height / 2);
  ctx.rotate(-Math.PI / 6);
  const textWidth = ctx.measureText(label).width + fontSize * 4;
  const stepY = fontSize * 7;
  const span = Math.hypot(img.width, img.height);
  for (let y = -span / 2; y < span / 2; y += stepY) {
    const offset = (Math.round(y / stepY) % 2) * (textWidth / 2);
    for (let x = -span / 2 - offset; x < span / 2; x += textWidth) ctx.fillText(label, x, y);
  }
  ctx.restore();

  const footer = `Uso interno e confidencial · ${info.name} · ${info.code} · ${info.date} · sessão ${info.session}`;
  const fs = Math.max(12, Math.round(img.width / 110));
  ctx.font = `${fs}px LCWatermark`;
  ctx.fillStyle = "rgba(20, 30, 40, 0.55)";
  ctx.textAlign = "center";
  ctx.fillText(footer, img.width / 2, img.height - fs * 0.9);

  return canvas.encode("webp", 80);
}
