/**
 * Confere, no build, se o servidor carrega no runtime de funções da Vercel. Esse runtime não aceita
 * require() de módulos ESM, então este script roda com `node --no-experimental-require-module`.
 * Se uma dependência quebrar isso, o build falha aqui e a versão publicada anterior continua no ar.
 */
const modules = [
  // O servidor inteiro (tudo que ele importa de forma estática).
  "../app.js",
  // Módulos carregados sob demanda no modo serverless.
  "pg",
  "drizzle-orm/node-postgres",
  "drizzle-orm/node-postgres/migrator",
  "@vercel/functions",
  "@vercel/blob/client",
  "pdfjs-dist/legacy/build/pdf.mjs",
];

const failures: string[] = [];
for (const name of modules) {
  try {
    await import(name);
  } catch (err) {
    failures.push(`${name}: ${String((err as Error)?.message ?? err).split("\n")[0]}`);
  }
}

if (failures.length) {
  console.error("Falha: o servidor não carrega no runtime da Vercel (sem require() de ESM).");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("Use import() dinâmico para a dependência citada ou fixe uma versão compatível com CommonJS.");
  process.exit(1);
}
console.log("Servidor compatível com o runtime de funções da Vercel.");
