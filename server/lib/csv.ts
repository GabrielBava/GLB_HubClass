/** Gera CSV (separador ;, compatível com Excel em português) protegido contra injeção de fórmulas. */
export function toCsv(headers: string[], rows: (string | number | boolean | null | undefined | Date)[][]): string {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[;"\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  return "﻿" + [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}
