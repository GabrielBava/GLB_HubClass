import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import type { QuestionType } from "../../../shared/domain";
import { Input, Select, Textarea, cx } from "./ui";

export interface QuestionData {
  id: string;
  type: QuestionType;
  prompt: string;
  context: string;
  points: number;
  options: Record<string, unknown>;
  response?: unknown;
  isCorrect?: boolean | null;
  pointsAwarded?: number | null;
  maxPoints?: number;
  reviewerComment?: string | null;
  answerKey?: Record<string, unknown>;
  explanation?: string;
}

type Choice = { id: string; text: string };

const optionClass = (selected: boolean, state?: "correct" | "wrong" | null) =>
  cx(
    "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition",
    state === "correct" ? "border-success bg-success/10" : state === "wrong" ? "border-danger bg-danger/10" : selected ? "border-primary bg-primary/8" : "border-border hover:bg-subtle",
  );

function Marker({ type, selected }: { type: "radio" | "check"; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "mt-0.5 grid h-5 w-5 shrink-0 place-items-center border-2",
        type === "radio" ? "rounded-full" : "rounded-md",
        selected ? "border-primary bg-primary text-primary-fg" : "border-border",
      )}
    >
      {selected && (type === "radio" ? <span className="h-2 w-2 rounded-full bg-current" /> : <Check className="h-3 w-3" />)}
    </span>
  );
}

export function wordCount(t: string) {
  return t.trim() ? t.trim().split(/\s+/).length : 0;
}

/** Entrada de resposta para cada tipo de questão; no modo revisão mostra a correção. */
export function QuestionInput({ q, value, onChange, disabled, review }: { q: QuestionData; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; review?: boolean }) {
  const key = review ? q.answerKey : undefined;
  const v = (value ?? {}) as Record<string, unknown>;

  switch (q.type) {
    case "single_choice": {
      const choices = (q.options.choices as Choice[]) ?? [];
      return (
        <div role="radiogroup" aria-label={q.prompt} className="space-y-2">
          {choices.map((c) => {
            const selected = v.choice === c.id;
            const state = key ? (key.correct === c.id ? "correct" : selected ? "wrong" : null) : null;
            return (
              <button key={c.id} type="button" role="radio" aria-checked={selected} disabled={disabled} className={optionClass(selected, state)} onClick={() => onChange({ choice: c.id })}>
                <Marker type="radio" selected={selected} />
                <span className="flex-1">{c.text}</span>
                {state === "correct" && <Check className="h-4 w-4 text-success" aria-label="Resposta correta" />}
                {state === "wrong" && <X className="h-4 w-4 text-danger" aria-label="Resposta incorreta" />}
              </button>
            );
          })}
        </div>
      );
    }
    case "multiple_choice": {
      const choices = (q.options.choices as Choice[]) ?? [];
      const sel = new Set((v.choices as string[]) ?? []);
      const correct = new Set((key?.correct as string[]) ?? []);
      return (
        <div role="group" aria-label={q.prompt} className="space-y-2">
          <p className="text-xs text-muted">Marque todas as alternativas corretas.</p>
          {choices.map((c) => {
            const selected = sel.has(c.id);
            const state = key ? (correct.has(c.id) ? "correct" : selected ? "wrong" : null) : null;
            return (
              <button
                key={c.id}
                type="button"
                role="checkbox"
                aria-checked={selected}
                disabled={disabled}
                className={optionClass(selected, state)}
                onClick={() => {
                  const next = new Set(sel);
                  if (selected) next.delete(c.id);
                  else next.add(c.id);
                  onChange({ choices: [...next] });
                }}
              >
                <Marker type="check" selected={selected} />
                <span className="flex-1">{c.text}</span>
                {state === "correct" && <Check className="h-4 w-4 text-success" aria-label="Alternativa correta" />}
              </button>
            );
          })}
        </div>
      );
    }
    case "true_false": {
      return (
        <div role="radiogroup" aria-label={q.prompt} className="grid grid-cols-2 gap-2">
          {[true, false].map((b) => {
            const selected = v.value === b;
            const state = key ? (key.value === b ? "correct" : selected ? "wrong" : null) : null;
            return (
              <button key={String(b)} type="button" role="radio" aria-checked={selected} disabled={disabled} className={optionClass(selected, state)} onClick={() => onChange({ value: b })}>
                <Marker type="radio" selected={selected} />
                {b ? "Verdadeiro" : "Falso"}
              </button>
            );
          })}
        </div>
      );
    }
    case "matching": {
      const left = (q.options.left as Choice[]) ?? [];
      const right = (q.options.right as Choice[]) ?? [];
      const pairs = (v.pairs as Record<string, string>) ?? {};
      const kp = (key?.pairs as Record<string, string>) ?? {};
      return (
        <div className="space-y-2">
          {left.map((l) => {
            const ok = key ? kp[l.id] === pairs[l.id] : null;
            return (
              <div key={l.id} className={cx("grid gap-2 rounded-xl border p-3 sm:grid-cols-2 sm:items-center", ok === true ? "border-success" : ok === false ? "border-danger" : "border-border")}>
                <span className="text-sm font-medium">{l.text}</span>
                <div>
                  <Select
                    aria-label={`Associação para ${l.text}`}
                    disabled={disabled}
                    value={pairs[l.id] ?? ""}
                    onChange={(e) => onChange({ pairs: { ...pairs, [l.id]: e.target.value } })}
                    placeholder="Selecione..."
                    options={right.map((r) => ({ value: r.id, label: r.text }))}
                  />
                  {key && ok === false && <p className="mt-1 text-xs text-success">Correto: {right.find((r) => r.id === kp[l.id])?.text}</p>}
                </div>
              </div>
            );
          })}
        </div>
      );
    }
    case "ordering": {
      const items = (q.options.items as Choice[]) ?? [];
      const order = ((v.order as string[]) ?? items.map((i) => i.id)).filter((id) => items.some((i) => i.id === id));
      const byId = new Map(items.map((i) => [i.id, i]));
      const correct = (key?.order as string[]) ?? null;
      const move = (idx: number, dir: -1 | 1) => {
        const next = [...order];
        const j = idx + dir;
        if (j < 0 || j >= next.length) return;
        [next[idx], next[j]] = [next[j]!, next[idx]!];
        onChange({ order: next });
      };
      return (
        <div>
          <p className="mb-2 text-xs text-muted">Use as setas para colocar as etapas na ordem correta.</p>
          <ol className="space-y-2">
            {order.map((id, idx) => {
              const ok = correct ? correct[idx] === id : null;
              return (
                <li key={id} className={cx("flex items-center gap-3 rounded-xl border px-3 py-2 text-sm", ok === true ? "border-success" : ok === false ? "border-danger" : "border-border")}>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold">{idx + 1}</span>
                  <span className="flex-1">{byId.get(id)?.text}</span>
                  {!disabled && (
                    <span className="flex gap-1">
                      <button type="button" className="rounded p-1 text-muted hover:bg-subtle hover:text-fg disabled:opacity-30" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label={`Mover “${byId.get(id)?.text}” para cima`}>
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" className="rounded p-1 text-muted hover:bg-subtle hover:text-fg disabled:opacity-30" disabled={idx === order.length - 1} onClick={() => move(idx, 1)} aria-label={`Mover “${byId.get(id)?.text}” para baixo`}>
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {correct && <p className="mt-2 text-xs text-muted">Ordem correta: {correct.map((id) => byId.get(id)?.text).join(" → ")}</p>}
        </div>
      );
    }
    case "numeric": {
      const unit = q.options.unit as string | null;
      return (
        <div className="max-w-xs">
          <div className="flex items-center gap-2">
            {unit && <span className="text-sm text-muted">{unit}</span>}
            <Input
              type="number"
              step="any"
              inputMode="decimal"
              aria-label="Resposta numérica"
              disabled={disabled}
              value={typeof v.value === "number" ? String(v.value) : ""}
              onChange={(e) => onChange(e.target.value === "" ? null : { value: Number(e.target.value) })}
            />
          </div>
          {key && (
            <p className="mt-2 text-xs text-muted">
              Resposta esperada: {unit ? `${unit} ` : ""}
              {Number(key.value).toLocaleString("pt-BR")}
              {Number(key.tolerance) > 0 ? ` (± ${Number(key.tolerance).toLocaleString("pt-BR")})` : ""}
            </p>
          )}
        </div>
      );
    }
    case "essay": {
      const text = (v.text as string) ?? "";
      const min = q.options.minWords as number | null;
      return (
        <div>
          <Textarea aria-label="Resposta discursiva" disabled={disabled} value={text} onChange={(e) => onChange({ text: e.target.value })} className="min-h-[160px]" maxLength={20000} />
          <p className={cx("mt-1 text-xs", min && wordCount(text) < min ? "text-warning" : "text-muted")}>
            {wordCount(text)} palavra(s){min ? ` · mínimo sugerido: ${min}` : ""} · correção feita pelo líder
          </p>
          {key?.guidance ? <p className="mt-2 rounded-lg bg-subtle p-2 text-xs text-muted">Orientação de correção: {String(key.guidance)}</p> : null}
        </div>
      );
    }
    default:
      return null;
  }
}

export function isAnswered(q: QuestionData, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const v = value as Record<string, unknown>;
  switch (q.type) {
    case "single_choice":
      return !!v.choice;
    case "multiple_choice":
      return Array.isArray(v.choices) && v.choices.length > 0;
    case "true_false":
      return typeof v.value === "boolean";
    case "matching":
      return Object.values((v.pairs as Record<string, string>) ?? {}).filter(Boolean).length >= ((q.options.left as unknown[]) ?? []).length;
    case "ordering":
      return Array.isArray(v.order);
    case "numeric":
      return typeof v.value === "number" && !Number.isNaN(v.value);
    case "essay":
      return typeof v.text === "string" && v.text.trim().length > 0;
    default:
      return false;
  }
}
