import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Hammer, Lock, Send, Sparkles } from "lucide-react";
import { PRACTICE_STAGE_LABEL, SUBMISSION_STATUS_LABEL, type PracticeStage, type SubmissionStatus } from "../../../../shared/domain";
import { Alert, Badge, Button, Card, ErrorState, Field, Input, PageLoader, Textarea } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { NotFoundPage } from "../Errors";

interface ActivityData {
  activity: { id: string; title: string; instructions: string; stage: PracticeStage; deliverable: "text" | "link"; competency: string; requiresValidation: boolean; isRequired: boolean };
  status: SubmissionStatus | "not_submitted";
  locked: boolean;
  track: { id: string; title: string };
  module: { id: string; title: string };
  submissions: { id: string; attemptNumber: number; body: string; link: string | null; status: SubmissionStatus; submittedAt: string; reviewedAt: string | null; reviewerName: string | null; reviewerComment: string | null }[];
}

const tone = (s: string) => (s === "approved" ? "success" : s === "rejected" ? "danger" : s === "returned" ? "warning" : "info") as "success" | "danger" | "warning" | "info";

export function ActivityPage() {
  const { id = "" } = useParams();
  const url = `/api/activities/${id}`;
  const { data, isLoading, error, refetch } = useApi<ActivityData>(url);
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  useDocumentTitle(data?.activity.title);
  const submit = useAction(() => api.post(`/api/activities/${id}/submissions`, { body, link: link.trim() || null }), {
    invalidate: [url, "/api/tracks", "/api/modules", "/api/dashboard"],
    success: "Entrega enviada para avaliação.",
    onSuccess: () => {
      setBody("");
      setLink("");
    },
  });
  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const a = data.activity;
  const canSubmit = !data.locked && (data.status === "not_submitted" || data.status === "returned" || data.status === "rejected");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to={`/modulos/${data.module.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {data.module.title}
      </Link>
      <Card className="p-6 sm:p-8">
        <Badge tone="primary" icon={a.stage === "execute" ? Hammer : Sparkles}>Da teoria à prática · {PRACTICE_STAGE_LABEL[a.stage]}</Badge>
        <h1 className="mt-3 font-heading text-2xl font-bold">{a.title}</h1>
        {a.competency && <p className="mt-1 text-sm text-muted">Competência: {a.competency}</p>}
        <div className="mt-4 whitespace-pre-line leading-relaxed">{a.instructions}</div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Badge tone={data.status === "not_submitted" ? "neutral" : tone(data.status)}>{data.status === "not_submitted" ? "Não enviada" : SUBMISSION_STATUS_LABEL[data.status]}</Badge>
          {a.requiresValidation && <Badge>Validada pelo líder</Badge>}
          {!a.isRequired && <Badge>Opcional</Badge>}
        </div>
      </Card>
      {data.locked && <Alert tone="warning" icon={Lock}>Conclua os conteúdos obrigatórios do módulo para liberar esta atividade.</Alert>}
      {canSubmit && (
        <Card className="space-y-4 p-6">
          <h2 className="font-heading text-lg font-semibold">{data.submissions.length ? "Enviar nova versão" : "Sua entrega"}</h2>
          <Field label="Descrição da entrega" htmlFor="sub-body" hint="Descreva o que foi feito, o roteiro ou os resultados. Não inclua dados pessoais de clientes.">
            <Textarea id="sub-body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[180px]" maxLength={20000} />
          </Field>
          <Field label="Link (opcional)" htmlFor="sub-link" hint="Ex.: registro no CRM, gravação ou documento interno (https://...).">
            <Input id="sub-link" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" />
          </Field>
          <Button icon={Send} loading={submit.isPending} disabled={!body.trim() && !link.trim()} onClick={() => submit.mutate(undefined)}>
            Enviar para avaliação
          </Button>
        </Card>
      )}
      {data.submissions.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">Histórico de entregas</h2>
          {data.submissions.map((s) => (
            <Card key={s.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Entrega {s.attemptNumber} · {formatDateTime(s.submittedAt)}</p>
                <Badge tone={tone(s.status)}>{SUBMISSION_STATUS_LABEL[s.status]}</Badge>
              </div>
              {s.body && <p className="mt-2 whitespace-pre-line text-sm">{s.body}</p>}
              {s.link && (
                <a href={s.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block break-all text-sm text-primary hover:underline">
                  {s.link}
                </a>
              )}
              {s.reviewerComment && (
                <p className="mt-3 rounded-xl bg-subtle p-3 text-sm">
                  <strong>{s.reviewerName ?? "Líder"}:</strong> {s.reviewerComment}
                </p>
              )}
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
