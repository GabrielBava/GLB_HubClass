import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ArrowLeft, CheckCircle2, ClipboardCheck, Clock, Lock, RotateCcw, Send, XCircle } from "lucide-react";
import { ASSESSMENT_KIND_LABEL, QUESTION_TYPE_LABEL, type AssessmentKind } from "../../../../shared/domain";
import { isAnswered, QuestionInput, type QuestionData } from "../../components/QuestionInput";
import { useToast } from "../../components/toast";
import { Alert, Badge, Button, Card, ErrorState, KeyValue, Modal, PageLoader, Progress, ProgressRing, cx } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { NotFoundPage } from "../Errors";
import { assessmentStatusLabel } from "./Track";

interface AssessmentInfo {
  assessment: {
    id: string;
    title: string;
    description: string;
    kind: AssessmentKind;
    passingScore: number;
    maxAttempts: number | null;
    timeLimitMinutes: number | null;
    questionCount: number;
    feedbackMode: "after_submit" | "score_only";
    requiresPassToAdvance: boolean;
    requiresLeaderValidation: boolean;
  };
  status: keyof typeof assessmentStatusLabel;
  locked: boolean;
  bestScore: number | null;
  attempts: { id: string; number: number; status: string; score: number | null; passed: boolean | null; startedAt: string; submittedAt: string | null }[];
  track: { id: string; title: string };
  module: { id: string; title: string } | null;
}

export function AssessmentPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useApi<AssessmentInfo>(`/api/assessments/${id}`);
  useDocumentTitle(data?.assessment.title);
  const start = useAction(() => api.post<{ attemptId: string }>(`/api/assessments/${id}/attempts`), {
    onSuccess: (r) => navigate(`/avaliacoes/${id}/tentativas/${r.attemptId}`),
  });
  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const a = data.assessment;
  const inProgress = data.attempts.find((x) => x.status === "in_progress");
  const remaining = a.maxAttempts === null ? null : Math.max(0, a.maxAttempts - data.attempts.length);
  const canStart = !data.locked && data.status !== "passed" && data.status !== "pending_review" && data.status !== "failed_final";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={data.module ? `/modulos/${data.module.id}` : `/trilhas/${data.track.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {data.module?.title ?? data.track.title}
      </Link>
      <Card className="p-6 sm:p-8">
        <Badge tone="primary" icon={ClipboardCheck}>{ASSESSMENT_KIND_LABEL[a.kind]}</Badge>
        <h1 className="mt-3 font-heading text-2xl font-bold">{a.title}</h1>
        {a.description && <p className="mt-2 whitespace-pre-line text-muted">{a.description}</p>}
        <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_auto]">
          <KeyValue
            items={[
              ["Questões", a.questionCount],
              ["Nota mínima", `${a.passingScore}%`],
              ["Tentativas", a.maxAttempts === null ? "Ilimitadas" : `${data.attempts.length} de ${a.maxAttempts} usadas`],
              ["Tempo limite", a.timeLimitMinutes ? `${a.timeLimitMinutes} minutos` : "Sem limite"],
              ["Correção", a.feedbackMode === "after_submit" ? "Gabarito e explicações após o envio" : "Apenas a nota"],
              ...(a.requiresLeaderValidation ? ([["Validação", "Resultado confirmado pelo líder"]] as [string, string][]) : []),
            ]}
          />
          <div className="flex flex-col items-center gap-2">
            <ProgressRing value={data.bestScore ?? 0} size={96} label="Melhor nota">
              <span className="font-heading text-lg font-bold">{data.bestScore === null ? "—" : `${data.bestScore}%`}</span>
            </ProgressRing>
            <span className="text-xs text-muted">Melhor nota</span>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Badge tone={data.status === "passed" ? "success" : data.status === "failed_final" ? "danger" : data.status === "pending_review" ? "info" : "neutral"}>{assessmentStatusLabel[data.status]}</Badge>
          {data.locked ? (
            <Alert tone="warning" icon={Lock}>Conclua os conteúdos obrigatórios do módulo para liberar a avaliação.</Alert>
          ) : inProgress ? (
            <Button size="lg" icon={RotateCcw} onClick={() => navigate(`/avaliacoes/${id}/tentativas/${inProgress.id}`)}>Continuar tentativa</Button>
          ) : canStart ? (
            <Button size="lg" glow icon={ClipboardCheck} loading={start.isPending} onClick={() => start.mutate(undefined)}>
              {data.attempts.length ? "Nova tentativa" : "Iniciar avaliação"}
            </Button>
          ) : null}
          {remaining !== null && canStart && <span className="text-sm text-muted">{remaining} tentativa(s) restante(s)</span>}
        </div>
        {data.status === "failed_final" && <p className="mt-3 text-sm text-danger">Você usou todas as tentativas. Fale com seu líder para orientação e nova liberação.</p>}
      </Card>
      {data.attempts.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 font-heading text-base font-semibold">Histórico de tentativas</h2>
          <ul className="divide-y divide-border">
            {data.attempts.map((t) => (
              <li key={t.id}>
                <Link to={`/avaliacoes/${id}/tentativas/${t.id}`} className="flex items-center justify-between gap-3 py-3 hover:text-primary">
                  <span className="text-sm">
                    Tentativa {t.number} · {formatDateTime(t.submittedAt ?? t.startedAt)}
                  </span>
                  <span className="flex items-center gap-2 text-sm">
                    {t.status === "in_progress" ? <Badge>Em andamento</Badge> : t.status === "pending_review" ? <Badge tone="info">Aguardando correção</Badge> : <Badge tone={t.passed ? "success" : "danger"}>{t.score}% · {t.passed ? "aprovado" : "reprovado"}</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

interface AttemptData {
  attempt: { id: string; number: number; status: "in_progress" | "pending_review" | "graded"; startedAt: string; expiresAt: string | null; submittedAt: string | null; score: number | null; passed: boolean | null; feedback: string | null; serverNow: string };
  assessment: { id: string; title: string; passingScore: number; maxAttempts: number | null; feedbackMode: string; trackId: string; moduleId: string | null };
  attemptsUsed: number;
  questions: QuestionData[];
}

function Countdown({ expiresAt, skew, onExpire }: { expiresAt: string; skew: number; onExpire: () => void }) {
  const [left, setLeft] = useState(() => new Date(expiresAt).getTime() - (Date.now() + skew));
  const fired = useRef(false);
  useEffect(() => {
    const t = setInterval(() => {
      const l = new Date(expiresAt).getTime() - (Date.now() + skew);
      setLeft(l);
      if (l <= 0 && !fired.current) {
        fired.current = true;
        onExpire();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt, skew, onExpire]);
  const s = Math.max(0, Math.floor(left / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold tabular-nums", s < 60 ? "bg-danger/10 text-danger" : "bg-subtle")} role="timer" aria-live={s < 60 ? "assertive" : "off"}>
      <AlarmClock className="h-4 w-4" aria-hidden /> {mm}:{ss}
    </span>
  );
}

export function AttemptPage() {
  const { id = "", attemptId = "" } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const url = `/api/attempts/${attemptId}`;
  const { data, isLoading, error, refetch } = useApi<AttemptData>(url);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [saving, setSaving] = useState(0);
  useDocumentTitle(data?.assessment.title);

  useEffect(() => {
    if (!data) return;
    const initial: Record<string, unknown> = {};
    for (const q of data.questions) initial[q.id] = q.response ?? null;
    setAnswers(initial);
  }, [data?.attempt.id, data?.attempt.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (questionId: string, response: unknown) => {
    setAnswers((a) => ({ ...a, [questionId]: response }));
    const prev = timers.current.get(questionId);
    if (prev) clearTimeout(prev);
    timers.current.set(
      questionId,
      setTimeout(async () => {
        setSaving((n) => n + 1);
        try {
          await api.put(`/api/attempts/${attemptId}/answers`, { questionId, response });
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setSaving((n) => n - 1);
        }
      }, 600),
    );
  };

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      for (const t of timers.current.values()) clearTimeout(t);
      await api.post(`/api/attempts/${attemptId}/submit`, { answers: Object.entries(answers).map(([questionId, response]) => ({ questionId, response })) });
      setConfirm(false);
      await refetch();
      void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/") && q.queryKey[0] !== url });
      window.scrollTo(0, 0);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [answers, attemptId, qc, refetch, toast, url]);

  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const { attempt, assessment, questions } = data;
  const back = assessment.moduleId ? `/modulos/${assessment.moduleId}` : `/trilhas/${assessment.trackId}`;

  if (attempt.status === "in_progress") {
    const answered = questions.filter((q) => isAnswered(q, answers[q.id])).length;
    const skew = new Date(attempt.serverNow).getTime() - Date.now();
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="sticky top-16 z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
          <div className="min-w-0">
            <p className="truncate font-heading font-semibold">{assessment.title}</p>
            <p className="text-xs text-muted">
              Tentativa {attempt.number} · {answered} de {questions.length} respondidas {saving > 0 ? "· salvando..." : "· salvo automaticamente"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {attempt.expiresAt && <Countdown expiresAt={attempt.expiresAt} skew={skew} onExpire={() => { toast.info("Tempo esgotado: enviando suas respostas."); void submit(); }} />}
            <Button icon={Send} onClick={() => setConfirm(true)}>Enviar</Button>
          </div>
        </div>
        <Progress value={(answered / Math.max(1, questions.length)) * 100} label="Questões respondidas" />
        <ol className="space-y-4">
          {questions.map((q, i) => (
            <li key={q.id}>
              <Card className="p-5 sm:p-6">
                <p className="text-xs font-medium text-muted">
                  Questão {i + 1} · {QUESTION_TYPE_LABEL[q.type]} · {q.points} ponto(s)
                </p>
                {q.context && <p className="mt-3 whitespace-pre-line rounded-xl bg-subtle p-3 text-sm">{q.context}</p>}
                <h2 className="mt-3 font-medium leading-relaxed">{q.prompt}</h2>
                <div className="mt-4">
                  <QuestionInput q={q} value={answers[q.id]} onChange={(v) => save(q.id, v)} />
                </div>
              </Card>
            </li>
          ))}
        </ol>
        <div className="flex justify-end">
          <Button size="lg" icon={Send} onClick={() => setConfirm(true)}>Enviar respostas</Button>
        </div>
        <Modal
          open={confirm}
          onClose={() => setConfirm(false)}
          title="Enviar respostas?"
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>Revisar</Button>
              <Button loading={submitting} onClick={() => void submit()}>Enviar</Button>
            </>
          }
        >
          <p className="text-sm text-muted">
            Você respondeu {answered} de {questions.length} questões. Depois do envio não é possível alterar as respostas desta tentativa.
          </p>
        </Modal>
      </div>
    );
  }

  const pending = attempt.status === "pending_review";
  const passed = attempt.passed === true;
  const canRetry = !passed && !pending && (assessment.maxAttempts === null || data.attemptsUsed < assessment.maxAttempts);
  const showReview = questions.some((q) => q.answerKey);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={back} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar ao módulo
      </Link>
      <Card className="p-6 text-center sm:p-8">
        {pending ? (
          <>
            <Clock className="mx-auto h-12 w-12 text-info" aria-hidden />
            <h1 className="mt-4 font-heading text-2xl font-bold">Respostas enviadas</h1>
            <p className="mt-2 text-muted">Esta avaliação tem questões discursivas ou exige validação do líder. Você será avisado quando a correção for concluída.</p>
          </>
        ) : (
          <>
            <ProgressRing value={attempt.score ?? 0} size={128} stroke={11} label={`Nota: ${attempt.score}%`}>
              <span className="font-heading text-3xl font-bold">{attempt.score}%</span>
            </ProgressRing>
            <h1 className="mt-4 flex items-center justify-center gap-2 font-heading text-2xl font-bold">
              {passed ? <CheckCircle2 className="h-6 w-6 text-success" aria-hidden /> : <XCircle className="h-6 w-6 text-danger" aria-hidden />}
              {passed ? "Aprovado!" : "Ainda não foi desta vez"}
            </h1>
            <p className="mt-2 text-muted">
              Nota mínima: {assessment.passingScore}% · Tentativa {attempt.number}
              {assessment.maxAttempts !== null ? ` de ${assessment.maxAttempts}` : ""}
            </p>
          </>
        )}
        {attempt.feedback && <p className="mx-auto mt-4 max-w-xl rounded-xl bg-subtle p-3 text-sm">Feedback do líder: {attempt.feedback}</p>}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to={back}>
            <Button variant="outline">Voltar ao módulo</Button>
          </Link>
          {canRetry && (
            <Link to={`/avaliacoes/${id}`}>
              <Button icon={RotateCcw}>Fazer nova tentativa</Button>
            </Link>
          )}
        </div>
      </Card>
      {(showReview || pending || questions.some((q) => q.reviewerComment)) && (
        <section className="space-y-4">
          <h2 className="font-heading text-lg font-semibold">Correção</h2>
          {questions.map((q, i) => (
            <Card key={q.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium text-muted">Questão {i + 1} · {QUESTION_TYPE_LABEL[q.type]}</p>
                {q.isCorrect === true ? <Badge tone="success">Correta</Badge> : q.isCorrect === false ? <Badge tone="danger">{q.pointsAwarded ? `Parcial (${q.pointsAwarded}/${q.maxPoints})` : "Incorreta"}</Badge> : <Badge tone="info">Em correção</Badge>}
              </div>
              {q.context && <p className="mt-2 whitespace-pre-line rounded-xl bg-subtle p-3 text-sm">{q.context}</p>}
              <h3 className="mt-2 font-medium">{q.prompt}</h3>
              <div className="mt-3">
                <QuestionInput q={q} value={q.response} onChange={() => undefined} disabled review />
              </div>
              {q.explanation && <p className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">{q.explanation}</p>}
              {q.reviewerComment && <p className="mt-3 rounded-xl bg-subtle p-3 text-sm">Comentário do líder: {q.reviewerComment}</p>}
            </Card>
          ))}
        </section>
      )}
      {!showReview && !pending && assessment.feedbackMode === "score_only" && <p className="text-center text-sm text-muted">Esta avaliação mostra apenas a nota.</p>}
    </div>
  );
}
