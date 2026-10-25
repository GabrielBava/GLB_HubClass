import { z } from "zod";
import type { QuestionType } from "../../shared/domain.js";
import type { questions } from "../db/schema.js";

type Question = typeof questions.$inferSelect;

// ---------------------------------------------------------------------------
// Definição das questões (validação do que o administrador cadastra)
// ---------------------------------------------------------------------------
const choice = z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(1000) });
const choices = z.array(choice).min(2, "Inclua pelo menos duas alternativas.").max(12);

export const questionDefinition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("single_choice"), options: z.object({ choices }), answerKey: z.object({ correct: z.string() }) }),
  z.object({
    type: z.literal("multiple_choice"),
    options: z.object({ choices }),
    answerKey: z.object({ correct: z.array(z.string()).min(1, "Marque ao menos uma alternativa correta.") }),
  }),
  z.object({ type: z.literal("true_false"), options: z.object({}).passthrough().default({}), answerKey: z.object({ value: z.boolean() }) }),
  z.object({
    type: z.literal("matching"),
    options: z.object({ left: z.array(choice).min(2).max(10), right: z.array(choice).min(2).max(12) }),
    answerKey: z.object({ pairs: z.record(z.string(), z.string()) }),
  }),
  z.object({
    type: z.literal("ordering"),
    options: z.object({ items: z.array(choice).min(2).max(12) }),
    answerKey: z.object({ order: z.array(z.string()).min(2) }),
  }),
  z.object({
    type: z.literal("numeric"),
    options: z.object({ unit: z.string().max(20).optional() }).default({}),
    answerKey: z.object({ value: z.number(), tolerance: z.number().min(0).default(0) }),
  }),
  z.object({
    type: z.literal("essay"),
    options: z.object({ minWords: z.number().int().min(0).max(5000).optional() }).default({}),
    answerKey: z.object({ guidance: z.string().max(5000).optional() }).default({}),
  }),
]);

/** Verifica a coerência entre alternativas e gabarito. Retorna a mensagem de erro ou null. */
export function checkDefinition(def: z.infer<typeof questionDefinition>): string | null {
  switch (def.type) {
    case "single_choice":
      return def.options.choices.some((c) => c.id === def.answerKey.correct) ? null : "Indique a alternativa correta.";
    case "multiple_choice":
      return def.answerKey.correct.every((id) => def.options.choices.some((c) => c.id === id)) ? null : "Gabarito com alternativa inexistente.";
    case "matching": {
      const left = new Set(def.options.left.map((c) => c.id));
      const right = new Set(def.options.right.map((c) => c.id));
      const pairs = Object.entries(def.answerKey.pairs);
      if (pairs.length !== left.size) return "Associe todos os itens da coluna da esquerda.";
      return pairs.every(([l, r]) => left.has(l) && right.has(r)) ? null : "Associação com item inexistente.";
    }
    case "ordering": {
      const ids = new Set(def.options.items.map((c) => c.id));
      return def.answerKey.order.length === ids.size && def.answerKey.order.every((id) => ids.has(id)) ? null : "A ordem correta deve incluir todos os itens.";
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Embaralhamento determinístico (mesma ordem ao recarregar a tentativa)
// ---------------------------------------------------------------------------
function seedFrom(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  let a = seedFrom(seed);
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface ClientQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  context: string;
  points: number;
  options: Record<string, unknown>;
}

/** Questão como o colaborador a vê: sem gabarito, com alternativas embaralhadas por tentativa. */
export function sanitizeQuestion(q: Question, seed: string, shuffle: boolean): ClientQuestion {
  const o = q.options as Record<string, unknown>;
  let options: Record<string, unknown> = {};
  switch (q.type) {
    case "single_choice":
    case "multiple_choice": {
      const list = (o.choices as { id: string; text: string }[]) ?? [];
      options = { choices: shuffle ? seededShuffle(list, `${seed}:${q.id}`) : list };
      break;
    }
    case "matching":
      options = { left: o.left ?? [], right: seededShuffle((o.right as unknown[]) ?? [], `${seed}:${q.id}:r`) };
      break;
    case "ordering":
      options = { items: seededShuffle((o.items as unknown[]) ?? [], `${seed}:${q.id}:o`) };
      break;
    case "numeric":
      options = { unit: o.unit ?? null };
      break;
    case "essay":
      options = { minWords: o.minWords ?? null };
      break;
    default:
      options = {};
  }
  return { id: q.id, type: q.type, prompt: q.prompt, context: q.context, points: q.points, options };
}

export function orderQuestions<T extends { id: string }>(list: T[], seed: string, shuffle: boolean) {
  return shuffle ? seededShuffle(list, seed) : list;
}

// ---------------------------------------------------------------------------
// Respostas e correção automática
// ---------------------------------------------------------------------------
const responseSchemas: Record<QuestionType, z.ZodTypeAny> = {
  single_choice: z.object({ choice: z.string().max(40) }),
  multiple_choice: z.object({ choices: z.array(z.string().max(40)).max(12) }),
  true_false: z.object({ value: z.boolean() }),
  matching: z.object({ pairs: z.record(z.string().max(40), z.string().max(40)) }),
  ordering: z.object({ order: z.array(z.string().max(40)).max(12) }),
  numeric: z.object({ value: z.number().finite() }),
  essay: z.object({ text: z.string().max(20_000) }),
};

export function parseResponse(type: QuestionType, response: unknown): unknown | null {
  const r = responseSchemas[type].safeParse(response);
  return r.success ? r.data : null;
}

export interface GradeResult {
  isCorrect: boolean | null;
  points: number | null;
}

/** Corrige uma resposta. Questões discursivas retornam null (correção manual pelo líder). */
export function gradeResponse(q: Question, response: unknown): GradeResult {
  const key = q.answerKey as Record<string, unknown>;
  const max = q.points;
  if (q.type === "essay") return { isCorrect: null, points: null };
  const r = response ? parseResponse(q.type, response) : null;
  if (!r) return { isCorrect: false, points: 0 };
  switch (q.type) {
    case "single_choice": {
      const ok = (r as { choice: string }).choice === key.correct;
      return { isCorrect: ok, points: ok ? max : 0 };
    }
    case "multiple_choice": {
      const got = new Set((r as { choices: string[] }).choices);
      const want = new Set(key.correct as string[]);
      const ok = got.size === want.size && [...want].every((x) => got.has(x));
      return { isCorrect: ok, points: ok ? max : 0 };
    }
    case "true_false": {
      const ok = (r as { value: boolean }).value === key.value;
      return { isCorrect: ok, points: ok ? max : 0 };
    }
    case "matching": {
      const want = key.pairs as Record<string, string>;
      const got = (r as { pairs: Record<string, string> }).pairs;
      const total = Object.keys(want).length || 1;
      const right = Object.entries(want).filter(([l, rr]) => got[l] === rr).length;
      return { isCorrect: right === total, points: Math.round((right / total) * max * 100) / 100 };
    }
    case "ordering": {
      const want = key.order as string[];
      const got = (r as { order: string[] }).order;
      const right = want.filter((id, i) => got[i] === id).length;
      return { isCorrect: right === want.length, points: Math.round((right / (want.length || 1)) * max * 100) / 100 };
    }
    case "numeric": {
      const value = (r as { value: number }).value;
      const target = Number(key.value);
      const tolerance = Number(key.tolerance ?? 0);
      const ok = Math.abs(value - target) <= tolerance + 1e-9;
      return { isCorrect: ok, points: ok ? max : 0 };
    }
    default:
      return { isCorrect: null, points: null };
  }
}

/** Gabarito em formato legível, mostrado após o envio quando a avaliação permite. */
export function answerKeyForFeedback(q: Question): Record<string, unknown> {
  const key = q.answerKey as Record<string, unknown>;
  if (q.type === "essay") return { guidance: key.guidance ?? null };
  return key;
}
