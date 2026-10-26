import { describe, expect, it } from "vitest";
import { estimateReadingMinutes, formatMinutes } from "../shared/reading.js";
import { checkDefinition, gradeResponse, questionDefinition } from "../server/services/grading.js";
import { toCsv } from "../server/lib/csv.js";
import { passwordProblems } from "../server/auth/password.js";
import type { questions } from "../server/db/schema.js";

type Question = typeof questions.$inferSelect;
const question = (type: Question["type"], answerKey: Record<string, unknown>, points = 2) => ({ type, answerKey, points }) as Question;

describe("tempo estimado de leitura", () => {
  it("usa palavras ÷ palavras por minuto, com fator de complexidade", () => {
    expect(estimateReadingMinutes({ wordCount: 2000, pageCount: 8, wordsPerMinute: 200, minutesPerPageFallback: 2 })).toBe(10);
    expect(estimateReadingMinutes({ wordCount: 2000, pageCount: 8, wordsPerMinute: 200, minutesPerPageFallback: 2, factor: 1.5 })).toBe(15);
  });
  it("sem texto extraível (PDF digitalizado) usa minutos por página; o tempo manual prevalece", () => {
    expect(estimateReadingMinutes({ wordCount: 0, pageCount: 5, wordsPerMinute: 200, minutesPerPageFallback: 2 })).toBe(10);
    expect(estimateReadingMinutes({ wordCount: 5000, pageCount: 20, wordsPerMinute: 200, minutesPerPageFallback: 2, overrideMinutes: 40 })).toBe(40);
  });
  it("formata minutos e horas", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(90)).toBe("1 h 30 min");
    expect(formatMinutes(0)).toBe("—");
  });
});

describe("correção automática", () => {
  it("múltipla escolha com várias respostas exige o conjunto exato", () => {
    const q = question("multiple_choice", { correct: ["a", "c"] });
    expect(gradeResponse(q, { choices: ["c", "a"] })).toEqual({ isCorrect: true, points: 2 });
    expect(gradeResponse(q, { choices: ["a"] })).toEqual({ isCorrect: false, points: 0 });
  });
  it("associação e ordenação dão crédito parcial", () => {
    const m = question("matching", { pairs: { l1: "r1", l2: "r2" } });
    expect(gradeResponse(m, { pairs: { l1: "r1", l2: "r9" } })).toEqual({ isCorrect: false, points: 1 });
    const o = question("ordering", { order: ["x", "y", "z", "w"] });
    expect(gradeResponse(o, { order: ["x", "y", "w", "z"] })).toEqual({ isCorrect: false, points: 1 });
  });
  it("cálculo aceita a tolerância configurada; discursiva fica para correção manual", () => {
    const n = question("numeric", { value: 1234.56, tolerance: 0.01 });
    expect(gradeResponse(n, { value: 1234.55 }).isCorrect).toBe(true);
    expect(gradeResponse(n, { value: 1234.4 }).isCorrect).toBe(false);
    expect(gradeResponse(question("essay", {}), { text: "resposta" })).toEqual({ isCorrect: null, points: null });
  });
  it("resposta em formato inválido vale zero", () => {
    expect(gradeResponse(question("true_false", { value: true }), { value: "sim" })).toEqual({ isCorrect: false, points: 0 });
  });
  it("valida o gabarito no cadastro da questão", () => {
    const def = questionDefinition.parse({ type: "single_choice", options: { choices: [{ id: "a", text: "Sim" }, { id: "b", text: "Não" }] }, answerKey: { correct: "z" } });
    expect(checkDefinition(def)).toBe("Indique a alternativa correta.");
  });
});

describe("exportação CSV", () => {
  it("neutraliza fórmulas e escapa separadores", () => {
    const csv = toCsv(["Nome", "Obs"], [["=HYPERLINK(\"x\")", "a;b"]]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('"a;b"');
  });
});

describe("política de senha", () => {
  it("aceita senha forte e rejeita nome, datas e senhas comuns", () => {
    expect(passwordProblems("Trilha-segura-2026x", { minLength: 10, name: "Ana Souza" })).toEqual([]);
    expect(passwordProblems("souza-2026-abc", { minLength: 10, name: "Ana Souza" })).toContain("Não use seu nome ou e-mail na senha.");
    expect(passwordProblems("aniver12/05/1990", { minLength: 10 })).toContain("Não use datas ou sequências longas de números.");
    expect(passwordProblems("password123", { minLength: 8 })).toContain("Esta senha é muito comum. Escolha outra.");
    expect(passwordProblems("somenteletras", { minLength: 8 })).toContain("Combine letras e números.");
  });
});
