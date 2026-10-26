import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Check, ClipboardCheck, CornerUpLeft, ShieldCheck, X } from "lucide-react";
import { PRACTICE_STAGE_LABEL, QUESTION_TYPE_LABEL, type PracticeStage } from "../../../../shared/domain";
import { QuestionInput, type QuestionData } from "../../components/QuestionInput";
import { PillarsView, type Pillars } from "../../components/learning";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, PageHeader, PageLoader, Tabs, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";

interface Queue {
  submissions: { id: string; userId: string; userName: string; activityTitle: string; instructions: string; stage: PracticeStage; competency: string; trackTitle: string; body: string; link: string | null; attemptNumber: number; submittedAt: string }[];
  attempts: { id: string; userId: string; userName: string; title: string; trackTitle: string; number: number; submittedAt: string }[];
  tracks: { userId: string; userName: string; trackId: string; trackTitle: string; pillars: Pillars }[];
}

function SubmissionCard({ s }: { s: Queue["submissions"][number] }) {
  const [comment, setComment] = useState("");
  const review = useAction((decision: "approved" | "rejected" | "returned") => api.post(`/api/leader/submissions/${s.id}/review`, { decision, comment }), {
    invalidate: ["/api/leader"],
    success: "Avaliação registrada e enviada ao colaborador.",
  });
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-heading font-semibold">{s.activityTitle}</p>
          <p className="text-xs text-muted">
            <Link to={`/lider/equipe/${s.userId}`} className="text-primary hover:underline">{s.userName}</Link> · {s.trackTitle} · entrega {s.attemptNumber} · {formatDateTime(s.submittedAt)}
          </p>
        </div>
        <Badge tone="primary">{PRACTICE_STAGE_LABEL[s.stage]}</Badge>
      </div>
      {s.competency && <p className="mt-2 text-sm text-muted">Competência: {s.competency}</p>}
      <details className="mt-2 text-sm text-muted"><summary className="cursor-pointer">Ver instruções</summary><p className="mt-1 whitespace-pre-line">{s.instructions}</p></details>
      <div className="mt-3 rounded-xl bg-subtle p-4 text-sm">
        {s.body && <p className="whitespace-pre-line">{s.body}</p>}
        {s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-primary hover:underline">{s.link}</a>}
      </div>
      <Field label="Comentário para o colaborador" htmlFor={`c-${s.id}`} className="mt-3" hint="Obrigatório para devolver ou reprovar.">
        <Textarea id={`c-${s.id}`} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[72px]" />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button icon={Check} loading={review.isPending && review.variables === "approved"} onClick={() => review.mutate("approved")}>Aprovar</Button>
        <Button variant="outline" icon={CornerUpLeft} disabled={!comment.trim()} onClick={() => review.mutate("returned")}>Devolver com comentários</Button>
        <Button variant="ghost" icon={X} className="text-danger" disabled={!comment.trim()} onClick={() => review.mutate("rejected")}>Reprovar</Button>
      </div>
    </Card>
  );
}

function TrackValidationCard({ t }: { t: Queue["tracks"][number] }) {
  const [comment, setComment] = useState("");
  const validate = useAction((decision: "approved" | "rejected") => api.post("/api/leader/validations", { userId: t.userId, trackId: t.trackId, decision, comment }), {
    invalidate: ["/api/leader"],
    success: "Validação registrada.",
  });
  return (
    <Card className="p-5">
      <p className="font-heading font-semibold">{t.trackTitle}</p>
      <p className="mb-3 text-xs text-muted"><Link to={`/lider/equipe/${t.userId}`} className="text-primary hover:underline">{t.userName}</Link> concluiu as etapas e aguarda a validação final.</p>
      <PillarsView pillars={t.pillars} compact />
      <Field label="Comentário" htmlFor={`tv-${t.trackId}-${t.userId}`} className="mt-3">
        <Textarea id={`tv-${t.trackId}-${t.userId}`} value={comment} onChange={(e) => setComment(e.target.value)} className="min-h-[60px]" />
      </Field>
      <div className="mt-3 flex gap-2">
        <Button icon={ShieldCheck} loading={validate.isPending} onClick={() => validate.mutate("approved")}>Validar competência</Button>
        <Button variant="outline" disabled={!comment.trim()} onClick={() => validate.mutate("rejected")}>Solicitar revisão</Button>
      </div>
    </Card>
  );
}

export function ValidationsPage() {
  const { data, isLoading, error, refetch } = useApi<Queue>("/api/leader/validations");
  const [tab, setTab] = useState<"submissions" | "attempts" | "tracks">("submissions");
  useDocumentTitle("Validações");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  return (
    <div>
      <PageHeader title="Validações" description="Avalie atividades práticas, corrija respostas discursivas e valide competências da sua equipe." />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "submissions", label: "Atividades práticas", count: data.submissions.length },
          { id: "attempts", label: "Correção de avaliações", count: data.attempts.length },
          { id: "tracks", label: "Validação de trilhas", count: data.tracks.length },
        ]}
      />
      {tab === "submissions" && (data.submissions.length ? <div className="space-y-4">{data.submissions.map((s) => <SubmissionCard key={s.id} s={s} />)}</div> : <EmptyState icon={ClipboardCheck} title="Nenhuma atividade aguardando avaliação" />)}
      {tab === "attempts" &&
        (data.attempts.length ? (
          <Card className="divide-y divide-border">
            {data.attempts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-muted">{a.userName} · {a.trackTitle} · tentativa {a.number} · {formatDateTime(a.submittedAt)}</p>
                </div>
                <Link to={`/lider/validacoes/tentativas/${a.id}`}><Button size="sm">Corrigir</Button></Link>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState icon={ClipboardCheck} title="Nenhuma avaliação aguardando correção" />
        ))}
      {tab === "tracks" && (data.tracks.length ? <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{data.tracks.map((t) => <TrackValidationCard key={`${t.userId}-${t.trackId}`} t={t} />)}</div> : <EmptyState icon={ShieldCheck} title="Nenhuma trilha aguardando validação" />)}
    </div>
  );
}

interface GradeData {
  attempt: { id: string; number: number; status: string; score: number | null; passed: boolean | null; submittedAt: string | null; feedback: string | null };
  assessment: { id: string; title: string; passingScore: number };
  member: { id: string; name: string };
  questions: (QuestionData & { answerKey: Record<string, unknown>; explanation: string })[];
}

export function GradeAttemptPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useApi<GradeData>(`/api/leader/attempts/${id}`);
  const [grades, setGrades] = useState<Record<string, { points: string; comment: string }>>({});
  const [feedback, setFeedback] = useState("");
  useDocumentTitle("Correção de avaliação");
  const submit = useAction(
    () =>
      api.post(`/api/leader/attempts/${id}/grade`, {
        answers: Object.entries(grades).map(([questionId, g]) => ({ questionId, points: Number(g.points.replace(",", ".")) || 0, comment: g.comment })),
        feedback,
      }),
    { invalidate: ["/api/leader"], success: "Correção concluída e enviada ao colaborador.", onSuccess: () => navigate("/lider/validacoes") },
  );
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const pending = data.attempt.status === "pending_review";
  const needsPoints = data.questions.filter((q) => q.pointsAwarded === null);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to="/lider/validacoes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" aria-hidden /> Validações</Link>
      <PageHeader title={data.assessment.title} description={`${data.member.name} · tentativa ${data.attempt.number} · enviada ${formatDateTime(data.attempt.submittedAt)} · nota mínima ${data.assessment.passingScore}%`} />
      {data.questions.map((q, i) => (
        <Card key={q.id} className="p-5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-muted">Questão {i + 1} · {QUESTION_TYPE_LABEL[q.type]} · vale {q.maxPoints ?? q.points}</p>
            {q.pointsAwarded !== null && <Badge tone={q.isCorrect ? "success" : "warning"}>{q.pointsAwarded}/{q.maxPoints} (automática)</Badge>}
          </div>
          {q.context && <p className="mt-2 whitespace-pre-line rounded-xl bg-subtle p-3 text-sm">{q.context}</p>}
          <p className="mt-2 font-medium">{q.prompt}</p>
          <div className="mt-3"><QuestionInput q={q} value={q.response} onChange={() => undefined} disabled review /></div>
          {pending && q.pointsAwarded === null && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
              <Field label={`Pontos (0 a ${q.maxPoints ?? q.points})`} htmlFor={`p-${q.id}`}>
                <Input id={`p-${q.id}`} inputMode="decimal" value={grades[q.id]?.points ?? ""} onChange={(e) => setGrades({ ...grades, [q.id]: { points: e.target.value, comment: grades[q.id]?.comment ?? "" } })} />
              </Field>
              <Field label="Comentário" htmlFor={`cm-${q.id}`}>
                <Input id={`cm-${q.id}`} value={grades[q.id]?.comment ?? ""} onChange={(e) => setGrades({ ...grades, [q.id]: { points: grades[q.id]?.points ?? "", comment: e.target.value } })} />
              </Field>
            </div>
          )}
        </Card>
      ))}
      {pending ? (
        <Card className="space-y-3 p-5">
          <Field label="Feedback geral (opcional)" htmlFor="g-fb"><Textarea id="g-fb" value={feedback} onChange={(e) => setFeedback(e.target.value)} /></Field>
          <Button loading={submit.isPending} disabled={needsPoints.some((q) => !grades[q.id]?.points)} onClick={() => submit.mutate(undefined)}>Concluir correção</Button>
        </Card>
      ) : (
        <Card className="p-5 text-sm">Tentativa já corrigida: {data.attempt.score}% ({data.attempt.passed ? "aprovado" : "reprovado"}).</Card>
      )}
    </div>
  );
}
