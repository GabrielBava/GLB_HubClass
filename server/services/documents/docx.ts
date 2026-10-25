import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function isDocx(buf: Buffer) {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) return false;
  const head = buf.toString("latin1");
  return head.includes("[Content_Types].xml") && head.includes("word/");
}

export function isMacroEnabled(buf: Buffer) {
  return buf.toString("latin1").includes("vbaProject.bin");
}

/**
 * Converte DOCX em PDF com o LibreOffice em modo headless, em diretório temporário isolado
 * e com perfil descartável. Requer o LibreOffice instalado no servidor (SOFFICE_PATH).
 */
export async function convertDocxToPdf(buf: Buffer, sofficePath: string, timeoutMs = 120_000): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lc-docx-"));
  try {
    const input = path.join(dir, "documento.docx");
    await writeFile(input, buf, { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      execFile(
        sofficePath,
        [`-env:UserInstallation=file://${path.join(dir, "profile")}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, input],
        { timeout: timeoutMs, env: { ...process.env, HOME: dir } },
        (err) => (err ? reject(new Error(`Falha na conversão do DOCX: ${err.message}`)) : resolve()),
      );
    });
    return await readFile(path.join(dir, "documento.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
