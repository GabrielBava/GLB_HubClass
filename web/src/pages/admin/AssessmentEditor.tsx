import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowDown, ArrowLeft, ArrowUp, BarChart3, Copy, Library, Pencil, Plus, Save, Search, Trash2, X } from "lucide-react";
import {
  ASSESSMENT_KINDS,
  ASSESSMENT_KIND_LABEL,
  FEEDBACK_MODES,
  FEEDBACK_MODE_LABEL,
  QUESTION_TYPES,
  QUESTION_TYPE_LABEL,
  type AssessmentKind,
  type FeedbackMode,
  type PublicationStatus,
  type QuestionType,
} from "../../../../shared/domain";
import { QuestionInput } from "../../components/QuestionInput";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, StatCard, TableWrap, Textarea, td, th } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useAction, useApi, useDebounced, useDocumentTitle } from "../../lib/hooks";
import { NotFoundPage } from "../Errors";
import { RevisionsButton, setStatus, StatusActions } from "./shared";

interface AssessmentFull {
  id: string;
  trackId: string;
  moduleId: string | null;
  title: string;
  description: string;
  kind: AssessmentKind;
  passingScore: number;
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  questionCount: number | null;
  shuffleQuestions: boolean;
  feedbackMode: FeedbackMode;
  isRequired: boolean;
  requiresPassToAdvance: boolean;
  requiresLeaderValidation: boolean;
  status: PublicationStatus;
}
interface QuestionRow {
  id: string;
  type: QuestionType;
  prompt: string;
  context: string;
  explanation: string;
  points: number;
  options: Record<string, unknown>;
  answerKey: Record<string, unknown>;
  isActive: boolean;
}
interface EditorData {
  assessment: AssessmentFull;
  track: { id: string; title: string; areaId: string };
  modules: { id: string; title: string }[];
  questions: QuestionRow[];
  attemptsCount: number;
  permissions: { canEdit: boolean; canPublish: boolean };
}

type Choice = { id: string; text: string };
interface QForm {
  id?: string;
  type: QuestionType;
  prompt: string;
  context: string;
  explanation: string;
  points: number;
  choices: Choice[];
  correct: string[];
  tf: boolean;
  pairs: { left: Choice; right: Choice }[];
  extraRight: Choice[];
  items: Choice[];
  numValue: string;
  tolerance: string;
  unit: string;
  minWords: string;
  guidance: string;
}

const newId = () => Math.random().toString(36).slice(2, 10);
const blankChoice = (): Choice => ({ id: newId(), text: "" });

function emptyForm(type: QuestionType = "single_choice"): QForm {
  return {
    type,
    prompt: "",
    context: "",
    explanation: "",
    points: 1,
    choices: [blankChoice(), blankChoice(), blankChoice(), blankChoice()],
    correct: [],
    tf: true,
    pairs: [
      { left: blankChoice(), right: blankChoice() },
      { left: blankChoice(), right: blankChoice() },
      { left: blankChoice(), right: blankChoice() },
    ],
    extraRight: [],
    items: [blankChoice(), blankChoice(), blankChoice()],
    numValue: "",
    tolerance: "0",
    unit: "",
    minWords: "",
    guidance: "",
  };
}

function formFromQuestion(q: QuestionRow): QForm {
  const f = emptyForm(q.type);
  const o = q.options;
  const k = q.answerKey;
  Object.assign(f, { id: q.id, prompt: q.prompt, context: q.context, explanation: q.explanation, points: q.points });
  switch (q.type) {
    case "single_choice":
      f.choices = (o.choices as Choice[]) ?? [];
      f.correct = k.correct ? [String(k.correct)] : [];
      break;
    case "multiple_choice":
      f.choices = (o.choices as Choice[]) ?? [];
      f.correct = (k.correct as string[]) ?? [];
      break;
    case "true_false":
      f.tf = k.value !== false;
      break;
    case "matching": {
      const left = (o.left as Choice[]) ?? [];
      const right = (o.right as Choice[]) ?? [];
      const pairs = (k.pairs as Record<string, string>) ?? {};
      f.pairs = left.map((l) => ({ left: l, right: right.find((r) => r.id === pairs[l.id]) ?? blankChoice() }));
      const used = new Set(Object.values(pairs));
      f.extraRight = right.filter((r) => !used.has(r.id));
      break;
    }
    case "ordering": {
      const items = (o.items as Choice[]) ?? [];
      const order = (k.order as string[]) ?? [];
      f.items = order.map((id) => items.find((i) => i.id === id)).filter((x): x is Choice => !!x);
      break;
    }
    case "numeric":
      f.numValue = k.value !== undefined ? String(k.value) : "";
      f.tolerance = k.tolerance !== undefined ? String(k.tolerance) : "0";
      f.unit = (o.unit as string) ?? "";
      break;
    case "essay":
      f.minWords = o.minWords ? String(o.minWords) : "";
      f.guidance = (k.guidance as string) ?? "";
      break;
  }
  return f;
}

function definition(f: QForm): { options: Record<string, unknown>; answerKey: Record<string, unknown> } {
  const clean = (list: Choice[]) => list.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);
  switch (f.type) {
    case "single_choice":
      return { options: { choices: clean(f.choices) }, answerKey: { correct: f.correct[0] ?? "" } };
    case "multiple_choice":
      return { options: { choices: clean(f.choices) }, answerKey: { correct: f.correct } };
    case "true_false":
      return { options: {}, answerKey: { value: f.tf } };
    case "matching": {
      const pairs = f.pairs.filter((p) => p.left.text.trim() && p.right.text.trim());
      return {
        options: { left: pairs.map((p) => ({ id: p.left.id, text: p.left.text.trim() })), right: [...pairs.map((p) => ({ id: p.right.id, text: p.right.text.trim() })), ...clean(f.extraRight)] },
        answerKey: { pairs: Object.fromEntries(pairs.map((p) => [p.left.id, p.right.id])) },
      };
    }
    case "ordering": {
      const items = clean(f.items);
      return { options: { items }, answerKey: { order: items.map((i) => i.id) } };
    }
    case "numeric":
      return { options: f.unit.trim() ? { unit: f.unit.trim() } : {}, answerKey: { value: Number(f.numValue.replace(",", ".")), tolerance: Number(f.tolerance.replace(",", ".")) || 0 } };
    case "essay":
      return { options: f.minWords ? { minWords: Number(f.minWords) } : {}, answerKey: f.guidance.trim() ? { guidance: f.guidance.trim() } : {} };
  }
}

/** Problemas de preenchimento detectados antes de enviar (o servidor valida de novo). */
function formProblem(f: QForm): string | null {
  if (f.prompt.trim().length < 3) return "Escreva o enunciado.";
  const d = definition(f);
  if (f.type === "single_choice" || f.type === "multiple_choice") {
    const list = d.options.choices as Choice[];
    if (list.length < 2) return "Inclua pelo menos duas alternativas.";
    if (!f.correct.length || !f.correct.every((id) => list.some((c) => c.id === id))) return "Marque a alternativa correta.";
  }
  if (f.type === "matching" && (d.options.left as Choice[]).length < 2) return "Inclua pelo menos dois pares.";
  if (f.type === "ordering" && (d.options.items as Choice[]).length < 2) return "Inclua pelo menos dois itens.";
  if (f.type === "numeric" && !Number.isFinite(Number(f.numValue.replace(",", "."))) ) return "Informe o resultado numérico.";
  if (f.type === "numeric" && !f.numValue.trim()) return "Informe o resultado numérico.";
  return null;
}

function ChoiceList({ list, onChange, label, min = 2, max = 12, marker }: { list: Choice[]; onChange: (l: Choice[]) => void; label: string; min?: number; max?: number; marker?: (c: Choice) => React.ReactNode }) {
  return (
    <div className="space-y-2">
      {list.map((c, i) => (
        <div key={c.id} className="flex items-center gap-2">
          {marker?.(c)}
          <Input aria-label={`${label} ${i + 1}`} value={c.text} placeholder={`${label} ${i + 1}`} onChange={(e) => onChange(list.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)))} />
          <Button size="icon" variant="ghost" icon={X} aria-label={`Remover ${label.toLowerCase()} ${i + 1}`} disabled={list.length <= min} onClick={() => onChange(list.filter((x) => x.id !== c.id))} />
        </div>
      ))}
      {list.length < max && (
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => onChange([...list, blankChoice()])}>
          Adicionar {label.toLowerCase()}
        </Button>
      )}
    </div>
  );
}

function QuestionFields({ f, set }: { f: QForm; set: (p: Partial<QForm>) => void }) {
  switch (f.type) {
    case "single_choice":
    case "multiple_choice":
      return (
        <Field label={f.type === "single_choice" ? "Alternativas (marque a correta)" : "Alternativas (marque todas as corretas)"}>
          <ChoiceList
            list={f.choices}
            label="Alternativa"
            onChange={(choices) => set({ choices, correct: f.correct.filter((id) => choices.some((c) => c.id === id)) })}
            marker={(c) => (
              <input
                type={f.type === "single_choice" ? "radio" : "checkbox"}
                name="correct"
                className="h-5 w-5 accent-[var(--primary)]"
                aria-label="Alternativa correta"
                checked={f.correct.includes(c.id)}
                onChange={(e) => set({ correct: f.type === "single_choice" ? [c.id] : e.target.checked ? [...f.correct, c.id] : f.correct.filter((x) => x !== c.id) })}
              />
            )}
          />
        </Field>
      );
    case "true_false":
      return (
        <Field label="Resposta correta" htmlFor="q-tf">
          <Select id="q-tf" value={f.tf ? "true" : "false"} onChange={(e) => set({ tf: e.target.value === "true" })} options={[{ value: "true", label: "Verdadeiro" }, { value: "false", label: "Falso" }]} />
        </Field>
      );
    case "matching":
      return (
        <div className="space-y-4">
          <Field label="Pares corretos" hint="A coluna da direita é embaralhada para o colaborador.">
            <div className="space-y-2">
              {f.pairs.map((p, i) => (
                <div key={p.left.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <Input aria-label={`Conceito ${i + 1}`} placeholder={`Conceito ${i + 1}`} value={p.left.text} onChange={(e) => set({ pairs: f.pairs.map((x) => (x.left.id === p.left.id ? { ...x, left: { ...x.left, text: e.target.value } } : x)) })} />
                  <Input aria-label={`Definição ${i + 1}`} placeholder={`Definição ${i + 1}`} value={p.right.text} onChange={(e) => set({ pairs: f.pairs.map((x) => (x.left.id === p.left.id ? { ...x, right: { ...x.right, text: e.target.value } } : x)) })} />
                  <Button size="icon" variant="ghost" icon={X} aria-label={`Remover par ${i + 1}`} disabled={f.pairs.length <= 2} onClick={() => set({ pairs: f.pairs.filter((x) => x.left.id !== p.left.id) })} />
                </div>
              ))}
              {f.pairs.length < 10 && (
                <Button size="sm" variant="ghost" icon={Plus} onClick={() => set({ pairs: [...f.pairs, { left: blankChoice(), right: blankChoice() }] })}>
                  Adicionar par
                </Button>
              )}
            </div>
          </Field>
          <Field label="Definições extras (distratores, opcional)">
            <ChoiceList list={f.extraRight} min={0} max={4} label="Distrator" onChange={(extraRight) => set({ extraRight })} />
          </Field>
        </div>
      );
    case "ordering":
      return (
        <Field label="Etapas na ordem correta" hint="Cadastre na sequência certa; o sistema embaralha para o colaborador.">
          <ChoiceList list={f.items} label="Etapa" onChange={(items) => set({ items })} />
        </Field>
      );
    case "numeric":
      return (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Resultado correto" htmlFor="q-num" required>
            <Input id="q-num" inputMode="decimal" value={f.numValue} onChange={(e) => set({ numValue: e.target.value })} />
          </Field>
          <Field label="Tolerância (±)" htmlFor="q-tol" hint="Diferença aceita (ex.: arredondamento).">
            <Input id="q-tol" inputMode="decimal" value={f.tolerance} onChange={(e) => set({ tolerance: e.target.value })} />
          </Field>
          <Field label="Unidade" htmlFor="q-unit" hint="Ex.: R$, %, meses.">
            <Input id="q-unit" value={f.unit} maxLength={20} onChange={(e) => set({ unit: e.target.value })} />
          </Field>
        </div>
      );
    case "essay":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mínimo de palavras" htmlFor="q-min">
            <Input id="q-min" type="number" min={0} value={f.minWords} onChange={(e) => set({ minWords: e.target.value })} />
          </Field>
          <Field label="Orientação para quem corrige" htmlFor="q-guide" className="sm:col-span-2" hint="Visível apenas para líderes e administradores na correção manual.">
            <Textarea id="q-guide" value={f.guidance} onChange={(e) => set({ guidance: e.target.value })} />
          </Field>
        </div>
      );
  }
}

export function AssessmentEditorPage() {
  const { id = "" } = useParams();
  const url = `/api/admin/assessments/${id}`;
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useApi<EditorData>(url);
  const [form, setForm] = useState<AssessmentFull | null>(null);
  const [q, setQ] = useState<QForm | null>(null);
  const [previewQ, setPreviewQ] = useState<QuestionRow | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  useDocumentTitle(data?.assessment.title);
  useEffect(() => {
    if (data) setForm((f) => (f && f.id === data.assessment.id ? { ...f, status: data.assessment.status } : data.assessment));
  }, [data]);

  const inv = { invalidate: [url, "/api/admin/tracks", "/api/admin/questions", "/api/assessments", "/api/tracks"] };
  const save = useAction(
    () =>
      api.patch(url, {
        moduleId: form!.moduleId,
        title: form!.title,
        description: form!.description,
        kind: form!.kind,
        passingScore: form!.passingScore,
        maxAttempts: form!.maxAttempts || null,
        timeLimitMinutes: form!.timeLimitMinutes || null,
        questionCount: form!.questionCount || null,
        shuffleQuestions: form!.shuffleQuestions,
        feedbackMode: form!.feedbackMode,
        isRequired: form!.isRequired,
        requiresPassToAdvance: form!.requiresPassToAdvance,
        requiresLeaderValidation: form!.requiresLeaderValidation,
      }),
    { ...inv, success: "Configurações salvas." },
  );
  const status = useAction((s: PublicationStatus) => setStatus("assessments", id, s), { ...inv, success: "Status atualizado." });
  const saveQuestion = useAction(
    () => {
      const body = { type: q!.type, prompt: q!.prompt, context: q!.context, explanation: q!.explanation, points: q!.points, ...definition(q!) };
      return q!.id ? api.patch(`/api/admin/questions/${q!.id}`, body) : api.post(`${url}/questions`, body);
    },
    { ...inv, success: "Questão salva.", onSuccess: () => setQ(null) },
  );
  const delQuestion = useAction((qid: string) => api.del<{ deactivated: boolean }>(`/api/admin/questions/${qid}`), {
    ...inv,
    success: (r) => (r.deactivated ? "A questão já foi respondida: ela foi desativada e o histórico preservado." : "Questão excluída."),
  });
  const reactivate = useAction((qid: string) => api.patch(`/api/admin/questions/${qid}`, { isActive: true }), { ...inv, success: "Questão reativada." });
  const reorder = useAction((ids: string[]) => api.post(`${url}/questions/reorder`, { ids }), inv);
  const remove = useAction(() => api.del(url), { ...inv, success: "Avaliação excluída.", onSuccess: () => navigate(data ? `/admin/trilhas/${data.track.id}` : "/admin/conteudos") });

  if (isLoading || (data && !form)) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data || !form) return <ErrorState error={error} retry={refetch} />;
  const { permissions: p, assessment: a } = data;
  const set = (patch: Partial<AssessmentFull>) => setForm({ ...form, ...patch });
  const active = data.questions.filter((x) => x.isActive);
  const totalPoints = active.reduce((s, x) => s + x.points, 0);
  const hasEssay = active.some((x) => x.type === "essay");
  const problem = q ? formProblem(q) : null;
  const move = (i: number, dir: -1 | 1) => {
    const ids = data.questions.map((x) => x.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };

  return (
    <div>
      <Link to={`/admin/trilhas/${data.track.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {data.track.title}
      </Link>
      <PageHeader
        eyebrow={ASSESSMENT_KIND_LABEL[a.kind]}
        title={a.title}
        actions={
          <>
            <RevisionsButton entityType="assessment" entityId={id} />
            <Button variant="outline" size="sm" icon={BarChart3} onClick={() => navigate(`/admin/avaliacoes/${id}/resultados`)}>
              Resultados ({data.attemptsCount})
            </Button>
          </>
        }
      >
        <div className="mt-3">
          <StatusActions status={a.status} canEdit={p.canEdit} canPublish={p.canPublish} loading={status.isPending} onChange={(s) => status.mutate(s)} />
        </div>
      </PageHeader>

      {data.attemptsCount > 0 && (
        <div className="mb-5">
          <Alert tone="info" title="Avaliação com tentativas registradas">
            Alterações valem para as próximas tentativas. Questões já respondidas não são apagadas: são desativadas para preservar o histórico das notas.
          </Alert>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="h-fit p-5">
          <CardHeader title="Configurações" description="Nota mínima, tentativas, tempo, embaralhamento e devolutiva." />
          <fieldset disabled={!p.canEdit} className="mt-4 space-y-4">
            <Field label="Título" htmlFor="a-title" required>
              <Input id="a-title" value={form.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Instruções" htmlFor="a-desc">
              <Textarea id="a-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tipo" htmlFor="a-kind">
                <Select id="a-kind" value={form.kind} onChange={(e) => set({ kind: e.target.value as AssessmentKind })} options={ASSESSMENT_KINDS.map((k) => ({ value: k, label: ASSESSMENT_KIND_LABEL[k] }))} />
              </Field>
              <Field label="Módulo" htmlFor="a-mod">
                <Select id="a-mod" value={form.moduleId ?? ""} placeholder="Final da trilha" onChange={(e) => set({ moduleId: e.target.value || null })} options={data.modules.map((m) => ({ value: m.id, label: m.title }))} />
              </Field>
              <Field label="Nota mínima (%)" htmlFor="a-pass">
                <Input id="a-pass" type="number" min={0} max={100} value={form.passingScore} onChange={(e) => set({ passingScore: Number(e.target.value) })} />
              </Field>
              <Field label="Tentativas" htmlFor="a-att" hint="Vazio = ilimitadas.">
                <Input id="a-att" type="number" min={1} max={50} value={form.maxAttempts ?? ""} onChange={(e) => set({ maxAttempts: e.target.value ? Number(e.target.value) : null })} />
              </Field>
              <Field label="Tempo limite (min)" htmlFor="a-time" hint="Vazio = sem limite.">
                <Input id="a-time" type="number" min={1} max={600} value={form.timeLimitMinutes ?? ""} onChange={(e) => set({ timeLimitMinutes: e.target.value ? Number(e.target.value) : null })} />
              </Field>
              <Field label="Questões por tentativa" htmlFor="a-count" hint="Sorteio do conjunto. Vazio = todas.">
                <Input id="a-count" type="number" min={1} max={200} value={form.questionCount ?? ""} onChange={(e) => set({ questionCount: e.target.value ? Number(e.target.value) : null })} />
              </Field>
            </div>
            <Field label="Devolutiva" htmlFor="a-fb">
              <Select id="a-fb" value={form.feedbackMode} onChange={(e) => set({ feedbackMode: e.target.value as FeedbackMode })} options={FEEDBACK_MODES.map((m) => ({ value: m, label: FEEDBACK_MODE_LABEL[m] }))} />
            </Field>
            <div className="space-y-3">
              <Checkbox label="Embaralhar questões e alternativas" checked={form.shuffleQuestions} onChange={(v) => set({ shuffleQuestions: v })} />
              <Checkbox label="Avaliação obrigatória" checked={form.isRequired} onChange={(v) => set({ isRequired: v })} />
              <Checkbox label="Exigir aprovação para avançar" description="Bloqueia o módulo seguinte até a aprovação." checked={form.requiresPassToAdvance} onChange={(v) => set({ requiresPassToAdvance: v })} />
              <Checkbox label="Exigir validação do líder" description="Além da nota, o líder confirma o resultado." checked={form.requiresLeaderValidation} onChange={(v) => set({ requiresLeaderValidation: v })} />
            </div>
          </fieldset>
          {p.canEdit && (
            <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-border pt-4">
              {data.attemptsCount === 0 && p.canPublish ? (
                <ConfirmButton variant="ghost" icon={Trash2} title="Excluir avaliação" message="A avaliação e suas questões serão removidas." confirmLabel="Excluir" onConfirm={() => remove.mutateAsync(undefined)}>
                  Excluir
                </ConfirmButton>
              ) : (
                <span />
              )}
              <Button icon={Save} loading={save.isPending} disabled={form.title.trim().length < 2} onClick={() => save.mutate(undefined)}>
                Salvar
              </Button>
            </div>
          )}
        </Card>

        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-heading text-lg font-semibold">Questões</h2>
              <p className="text-sm text-muted">
                {active.length} ativa(s) · {totalPoints} ponto(s){hasEssay ? " · inclui correção manual" : ""}
              </p>
            </div>
            {p.canEdit && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" icon={Library} onClick={() => setBankOpen(true)}>
                  Importar do banco
                </Button>
                <Button size="sm" icon={Plus} onClick={() => setQ(emptyForm())}>
                  Nova questão
                </Button>
              </div>
            )}
          </div>
          {data.questions.length === 0 ? (
            <EmptyState title="Nenhuma questão cadastrada" description="Use múltipla escolha, verdadeiro ou falso, associação, ordenação, cálculo ou resposta discursiva." />
          ) : (
            <ol className="space-y-3">
              {data.questions.map((x, i) => (
                <li key={x.id}>
                  <Card className={`p-4 ${x.isActive ? "" : "opacity-60"}`}>
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-subtle text-sm font-semibold">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{x.prompt}</p>
                        <p className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted">
                          <Badge>{QUESTION_TYPE_LABEL[x.type]}</Badge>
                          <Badge>{x.points} ponto(s)</Badge>
                          {!x.isActive && <Badge tone="warning">Desativada</Badge>}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" icon={Search} aria-label="Ver como o colaborador" onClick={() => setPreviewQ(x)} />
                        {p.canEdit && (
                          <>
                            <Button size="icon" variant="ghost" icon={ArrowUp} aria-label="Mover para cima" disabled={i === 0} onClick={() => move(i, -1)} />
                            <Button size="icon" variant="ghost" icon={ArrowDown} aria-label="Mover para baixo" disabled={i === data.questions.length - 1} onClick={() => move(i, 1)} />
                            <Button size="icon" variant="ghost" icon={Pencil} aria-label="Editar questão" onClick={() => setQ(formFromQuestion(x))} />
                            {x.isActive ? (
                              <Button size="icon" variant="ghost" icon={Trash2} aria-label="Excluir questão" onClick={() => delQuestion.mutate(x.id)} />
                            ) : (
                              <Button size="sm" variant="ghost" onClick={() => reactivate.mutate(x.id)}>
                                Reativar
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <Modal
        open={!!q}
        onClose={() => setQ(null)}
        title={q?.id ? "Editar questão" : "Nova questão"}
        size="xl"
        footer={
          <>
            {problem && <span className="mr-auto self-center text-xs text-muted">{problem}</span>}
            <Button variant="ghost" onClick={() => setQ(null)}>
              Cancelar
            </Button>
            <Button loading={saveQuestion.isPending} disabled={!!problem} onClick={() => saveQuestion.mutate(undefined)}>
              Salvar questão
            </Button>
          </>
        }
      >
        {q && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <Field label="Tipo de questão" htmlFor="q-type">
                <Select
                  id="q-type"
                  value={q.type}
                  onChange={(e) => setQ({ ...emptyForm(e.target.value as QuestionType), id: q.id, prompt: q.prompt, context: q.context, explanation: q.explanation, points: q.points })}
                  options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABEL[t] }))}
                />
              </Field>
              <Field label="Pontos" htmlFor="q-points">
                <Input id="q-points" type="number" min={1} max={100} value={q.points} onChange={(e) => setQ({ ...q, points: Math.max(1, Number(e.target.value) || 1) })} />
              </Field>
            </div>
            <Field label="Contexto ou caso (opcional)" htmlFor="q-ctx" hint="Situação de atendimento, dados do cliente, tabela de valores...">
              <Textarea id="q-ctx" value={q.context} onChange={(e) => setQ({ ...q, context: e.target.value })} />
            </Field>
            <Field label="Enunciado" htmlFor="q-prompt" required>
              <Textarea id="q-prompt" value={q.prompt} onChange={(e) => setQ({ ...q, prompt: e.target.value })} />
            </Field>
            <QuestionFields f={q} set={(patch) => setQ({ ...q, ...patch })} />
            <Field label="Explicação da resposta" htmlFor="q-exp" hint="Mostrada após o envio quando a devolutiva completa está ativa.">
              <Textarea id="q-exp" value={q.explanation} onChange={(e) => setQ({ ...q, explanation: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal open={!!previewQ} onClose={() => setPreviewQ(null)} title="Como o colaborador vê" size="lg">
        {previewQ && (
          <div className="space-y-3">
            {previewQ.context && <p className="whitespace-pre-line rounded-xl bg-subtle p-3 text-sm">{previewQ.context}</p>}
            <p className="font-medium">{previewQ.prompt}</p>
            <QuestionInput q={{ ...previewQ, answerKey: undefined }} value={undefined} onChange={() => undefined} disabled />
          </div>
        )}
      </Modal>

      <BankModal open={bankOpen} onClose={() => setBankOpen(false)} assessmentId={id} onCopied={() => void refetch()} />
    </div>
  );
}

interface BankRow {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  assessmentId: string;
  assessmentTitle: string;
  trackTitle: string;
  areaName: string;
}

function useBank(filters: { areaId: string; type: string; q: string }) {
  const term = useDebounced(filters.q, 300);
  const params = new URLSearchParams();
  if (filters.areaId) params.set("areaId", filters.areaId);
  if (filters.type) params.set("type", filters.type);
  if (term.trim()) params.set("q", term.trim());
  return useApi<BankRow[]>(`/api/admin/questions?${params.toString()}`);
}

function BankFilters({ value, onChange }: { value: { areaId: string; type: string; q: string }; onChange: (v: { areaId: string; type: string; q: string }) => void }) {
  const { data: areas } = useApi<{ id: string; name: string }[]>("/api/admin/content/tree");
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Input aria-label="Buscar no enunciado" placeholder="Buscar no enunciado..." value={value.q} onChange={(e) => onChange({ ...value, q: e.target.value })} />
      <Select aria-label="Área" value={value.areaId} placeholder="Todas as áreas" onChange={(e) => onChange({ ...value, areaId: e.target.value })} options={(areas ?? []).map((a) => ({ value: a.id, label: a.name }))} />
      <Select aria-label="Tipo" value={value.type} placeholder="Todos os tipos" onChange={(e) => onChange({ ...value, type: e.target.value })} options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABEL[t] }))} />
    </div>
  );
}

function BankModal({ open, onClose, assessmentId, onCopied }: { open: boolean; onClose: () => void; assessmentId: string; onCopied: () => void }) {
  const [filters, setFilters] = useState({ areaId: "", type: "", q: "" });
  const { data, isLoading } = useBank(filters);
  const copy = useAction((qid: string) => api.post(`/api/admin/questions/${qid}/copy`, { assessmentId }), { success: "Questão copiada para esta avaliação.", onSuccess: onCopied, invalidate: [`/api/admin/assessments/${assessmentId}`] });
  const list = useMemo(() => (data ?? []).filter((r) => r.assessmentId !== assessmentId), [data, assessmentId]);
  return (
    <Modal open={open} onClose={onClose} title="Banco de questões" description="Copie questões de outras avaliações das áreas sob sua responsabilidade. A cópia é independente da original." size="xl">
      <BankFilters value={filters} onChange={setFilters} />
      <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
        {isLoading ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma questão encontrada.</p>
        ) : (
          list.map((r) => (
            <div key={r.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{r.prompt}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {QUESTION_TYPE_LABEL[r.type]} · {r.areaName} · {r.trackTitle} · {r.assessmentTitle}
                </p>
              </div>
              <Button size="sm" variant="outline" icon={Copy} loading={copy.isPending && copy.variables === r.id} onClick={() => copy.mutate(r.id)}>
                Copiar
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

export function QuestionBankPage() {
  const [filters, setFilters] = useState({ areaId: "", type: "", q: "" });
  const { data, isLoading, error, refetch } = useBank(filters);
  useDocumentTitle("Banco de questões");
  return (
    <div>
      <PageHeader title="Banco de questões" description="Todas as questões ativas das avaliações sob sua responsabilidade. Para reutilizar, abra a avaliação de destino e use “Importar do banco”." />
      <Card className="p-4">
        <BankFilters value={filters} onChange={setFilters} />
      </Card>
      <div className="mt-4">
        {isLoading ? (
          <PageLoader />
        ) : error ? (
          <ErrorState error={error} retry={refetch} />
        ) : !data?.length ? (
          <EmptyState title="Nenhuma questão encontrada" description="Ajuste os filtros ou cadastre questões nas avaliações." />
        ) : (
          <Card className="overflow-hidden">
            <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>Enunciado</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Origem</th>
                    <th className={th}>Pontos</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr key={r.id}>
                      <td className={`${td} max-w-md`}>{r.prompt}</td>
                      <td className={td}>{QUESTION_TYPE_LABEL[r.type]}</td>
                      <td className={td}>
                        <Link to={`/admin/avaliacoes/${r.assessmentId}`} className="font-medium text-primary hover:underline">
                          {r.assessmentTitle}
                        </Link>
                        <p className="text-xs text-muted">
                          {r.areaName} · {r.trackTitle}
                        </p>
                      </td>
                      <td className={td}>{r.points}</td>
                    </tr>
                  ))}
                </tbody>
            </TableWrap>
          </Card>
        )}
      </div>
    </div>
  );
}

interface Results {
  assessment: { id: string; title: string; passingScore: number };
  stats: { attempts: number; participants: number; averageScore: number | null; passRate: number | null; attemptsPerParticipant: number | null; pendingReview: number };
  questions: { id: string; prompt: string; type: QuestionType; answered: number; correctRate: number | null }[];
  attempts: { id: string; userId: string; name: string; code: string; number: number; status: "in_progress" | "pending_review" | "graded"; score: number | null; passed: boolean | null; submittedAt: string | null }[];
}

const ATTEMPT_STATUS_LABEL = { in_progress: "Em andamento", pending_review: "Aguardando correção", graded: "Corrigida" } as const;

export function AssessmentResultsPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error, refetch } = useApi<Results>(`/api/admin/assessments/${id}/results`);
  useDocumentTitle(data ? `Resultados · ${data.assessment.title}` : undefined);
  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const s = data.stats;
  // Questões com menor índice de acerto primeiro: são as que indicam lacunas de conteúdo.
  const hardest = [...data.questions].filter((x) => x.correctRate !== null).sort((x, y) => (x.correctRate ?? 0) - (y.correctRate ?? 0));
  return (
    <div>
      <Link to={`/admin/avaliacoes/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Voltar à avaliação
      </Link>
      <PageHeader eyebrow="Resultados" title={data.assessment.title} description={`Nota mínima para aprovação: ${data.assessment.passingScore}%.`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Participantes" value={s.participants} hint={`${s.attempts} tentativa(s)`} />
        <StatCard label="Média das notas" value={s.averageScore !== null ? `${s.averageScore.toLocaleString("pt-BR")}%` : "—"} />
        <StatCard label="Taxa de aprovação" value={s.passRate !== null ? `${s.passRate}%` : "—"} tone="success" />
        <StatCard label="Aguardando correção" value={s.pendingReview} tone="warning" hint={s.attemptsPerParticipant ? `${s.attemptsPerParticipant.toLocaleString("pt-BR")} tentativa(s) por pessoa` : undefined} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Índice de acerto por questão" description="Questões com menor acerto aparecem primeiro e indicam pontos do conteúdo a reforçar." />
          {hardest.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Ainda não há respostas corrigidas.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {hardest.map((x) => (
                <li key={x.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="line-clamp-2">{x.prompt}</span>
                    <span className="shrink-0 font-semibold tabular-nums">{x.correctRate}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-subtle" role="img" aria-label={`${x.correctRate}% de acerto em ${x.answered} resposta(s)`}>
                    <div className="h-full rounded-full" style={{ width: `${x.correctRate}%`, background: "var(--chart-1)" }} />
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{x.answered} resposta(s) corrigida(s)</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="overflow-hidden">
          <div className="p-5 pb-3">
            <CardHeader title="Tentativas" description="Líderes veem somente a própria equipe." />
          </div>
          {data.attempts.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">Nenhuma tentativa.</p>
          ) : (
            <TableWrap>
                <thead>
                  <tr>
                    <th className={th}>Colaborador</th>
                    <th className={th}>Tentativa</th>
                    <th className={th}>Situação</th>
                    <th className={th}>Nota</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map((r) => (
                    <tr key={r.id}>
                      <td className={td}>
                        <p className="font-medium">{r.name}</p>
                        <p className="text-xs text-muted">
                          {r.code}
                          {r.submittedAt ? ` · ${formatDateTime(r.submittedAt)}` : ""}
                        </p>
                      </td>
                      <td className={td}>#{r.number}</td>
                      <td className={td}>
                        {r.status === "pending_review" ? (
                          <Link to={`/lider/validacoes/tentativas/${r.id}`} className="text-primary hover:underline">
                            {ATTEMPT_STATUS_LABEL[r.status]}
                          </Link>
                        ) : (
                          ATTEMPT_STATUS_LABEL[r.status]
                        )}
                      </td>
                      <td className={td}>
                        {r.score !== null ? (
                          <Badge tone={r.passed ? "success" : "danger"}>
                            {r.score.toLocaleString("pt-BR")}% · {r.passed ? "Aprovado" : "Não aprovado"}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </div>
  );
}
