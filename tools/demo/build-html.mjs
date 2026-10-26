// Monta a demonstração estática em um único arquivo HTML (abre direto no navegador, sem servidor).
// Uso: npm run demo:build  (requer dist/demo-data.json gerado por `npm run demo:record`)
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist/demo");
const DATA = path.join(ROOT, "dist/demo-data.json");
const OUT = path.join(ROOT, process.argv[2] ?? "docs/demo/life-class-demo.html");

const read = (p) => readFileSync(path.join(DIST, p.replace(/^\//, "")), "utf8");
let html = read("index.html");

// Dados gravados: `<` escapado para que nenhum texto feche a tag <script> antes da hora.
const data = readFileSync(DATA, "utf8")
  .replace(/</g, "\\u003c")
  .replaceAll(String.fromCharCode(0x2028), "\\u2028")
  .replaceAll(String.fromCharCode(0x2029), "\\u2029");
const safeJs = (code) => code.replace(/<\/script/gi, "<\\/script");

html = html.replace(/<script src="\/theme-init\.js"><\/script>/, () => `<script>${safeJs(read("theme-init.js"))}</script>`);
const png = (p) => `data:image/png;base64,${readFileSync(path.join(DIST, p)).toString("base64")}`;
html = html.replace(/<link rel="icon"[^>]*href="\/favicon\.png"[^>]*>/, () => `<link rel="icon" type="image/png" href="${png("favicon.png")}">`);
html = html.replace(/<link rel="apple-touch-icon"[^>]*>/, () => `<link rel="apple-touch-icon" href="${png("apple-touch-icon.png")}">`);
html = html.replace(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/, (_, href) => `<style>${read(href)}</style>`);
html = html.replace(/<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"><\/script>/, (_, src) => `<script>window.__LC_DEMO__=${data};</script>\n<script type="module">${safeJs(read(src))}</script>`);

if (/src="\/assets\/|href="\/assets\//.test(html)) throw new Error("Restaram referências a arquivos externos no HTML da demonstração.");
html = html.replace("<title>LIFE CLASS</title>", "<title>LIFE CLASS · Demonstração</title>");

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`Demonstração: ${path.relative(ROOT, OUT)} (${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB)`);
