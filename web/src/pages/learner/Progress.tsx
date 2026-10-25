import { Link, useParams } from "react-router";
import { Award, BookOpenCheck, ClipboardCheck, Clock, Printer, Sparkles } from "lucide-react";
import { FEEDBACK_KIND_LABEL, PRACTICE_STAGE_LABEL, SUBMISSION_STATUS_LABEL, type FeedbackKind, type LearnerTrackStatus, type PracticeStage, type SubmissionStatus } from "../../../../shared/domain";
import { Brand } from "../../components/Brand";
import { DueBadge, PillarsView, StatusBadge, type Pillars } from "../../components/learning";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, PageLoader, Progress, StatCard, TableWrap, td, th } from "../../components/ui";
import { useBranding } from "../../lib/branding";
import { formatDate, formatMinutes, relativeTime } from "../../lib/format";
import { useApi, useDocumentTitle } from "../../lib/hooks";

interface ProgressData {
  tracks: { id: string; title: string; areaName: string; areaColor: string; status: LearnerTrackStatus; percent: number; pillars: Pillars; validation: { required: boolean; status: string }; isMandatory: boolean; dueDate: string | null; startedAt: string | null; completedAt: string | null; estimatedMinutes: number; remainingMinutes: number }[];
  attempts: { id: string; assessmentId: string; title: string; trackTitle: string; number: number; status: string; score: number | null; passed: boolean | null; submittedAt: string | null }[];
  submissions: { id: string; activityId: string; title: string; stage: PracticeStage; competency: string; trackTitle: string; status: SubmissionStatus; submittedAt: string; reviewerComment: string | null }[];
  certificates: { code: string; issuedAt: string; trackTitle: string; trackId: string }[];
  feedback: { id: string; kind: FeedbackKind; body: string; author: string | null; trackTitle: string | null; createdAt: string }[];
  totals: { activeMinutes: number; contentsCompleted: number; assessmentsPassed: number; practicalApproved: number };
}

export function ProgressPage() {
  const { data, isLoading, error, refetch } = useApi<ProgressData>("/api/me/progress");
  useDocumentTitle("Minha evolução");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  return (
    <div className="space-y-8">
      <PageHeader title="Minha evolução" description="Acompanhe separadamente o que foi estudado, avaliado, demonstrado e validado na prática." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Conteúdos concluídos" value={data.totals.contentsCompleted} icon={BookOpenCheck} />
        <StatCard label="Avaliações aprovadas" value={data.totals.assessmentsPassed} icon={ClipboardCheck} />
        <StatCard label="Atividades práticas aprovadas" value={data.totals.practicalApproved} icon={Sparkles} />
        <StatCard label="Tempo ativo de estudo" value={formatMinutes(data.totals.activeMinutes) || "0 min"} hint="Apenas leitura com interação" icon={Clock} />
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Trilhas</h2>
        {data.tracks.length === 0 && <EmptyState title="Nenhuma trilha iniciada" action={<Link to="/trilhas"><Button variant="outline" size="sm">Ver catálogo</Button></Link>} />}
        {data.tracks.map((t) => (
          <Card key={t.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium" style={{ color: t.areaColor }}>{t.areaName}</p>
                <Link to={`/trilhas/${t.id}`} className="font-heading text-base font-semibold hover:text-primary">{t.title}</Link>
                <p className="mt-0.5 text-xs text-muted">
                  Início {formatDate(t.startedAt)}
                  {t.completedAt ? ` · concluída em ${formatDate(t.completedAt)}` : t.remainingMinutes ? ` · ${formatMinutes(t.remainingMinutes)} restantes` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {t.isMandatory && <Badge tone="warning">Obrigatória</Badge>}
                <DueBadge due={t.dueDate} done={t.status === "completed"} />
                <StatusBadge status={t.status} />
              </div>
            </div>
            <div className="my-3 flex items-center gap-3">
              <Progress value={t.percent} label={`Progresso em ${t.title}`} />
              <span className="text-sm font-medium">{t.percent}%</span>
            </div>
            <PillarsView pillars={t.pillars} validation={t.validation} compact />
          </Card>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">Avaliações</h2>
          {data.attempts.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma avaliação realizada.</p>
          ) : (
            <TableWrap>
              <thead>
                <tr><th className={th}>Avaliação</th><th className={th}>Tentativa</th><th className={th}>Resultado</th></tr>
              </thead>
              <tbody>
                {data.attempts.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>
                      <Link to={`/avaliacoes/${a.assessmentId}/tentativas/${a.id}`} className="font-medium hover:text-primary">{a.title}</Link>
                      <p className="text-xs text-muted">{a.trackTitle}</p>
                    </td>
                    <td className={td}>{a.number}ª · {formatDate(a.submittedAt)}</td>
                    <td className={td}>{a.status === "graded" ? <Badge tone={a.passed ? "success" : "danger"}>{a.score}%</Badge> : <Badge tone="info">{a.status === "in_progress" ? "Em andamento" : "Em correção"}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">Da teoria à prática</h2>
          {data.submissions.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma atividade prática enviada.</p>
          ) : (
            <ul className="space-y-2">
              {data.submissions.map((s) => (
                <li key={s.id}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/atividades/${s.activityId}`} className="font-medium hover:text-primary">{s.title}</Link>
                      <Badge tone={s.status === "approved" ? "success" : s.status === "submitted" ? "info" : "warning"}>{SUBMISSION_STATUS_LABEL[s.status]}</Badge>
                    </div>
                    <p className="text-xs text-muted">{PRACTICE_STAGE_LABEL[s.stage]} · {s.trackTitle}</p>
                    {s.reviewerComment && <p className="mt-2 rounded-lg bg-subtle p-2 text-sm">{s.reviewerComment}</p>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">Certificações</h2>
          {data.certificates.length === 0 ? (
            <p className="text-sm text-muted">Conclua trilhas com certificado para conquistá-los.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.certificates.map((c) => (
                <li key={c.code}>
                  <Link to={`/certificados/${c.code}`}>
                    <Card className="flex items-center gap-3 p-4 hover:border-primary">
                      <Award className="h-8 w-8 text-primary" aria-hidden />
                      <div>
                        <p className="font-medium">{c.trackTitle}</p>
                        <p className="text-xs text-muted">{formatDate(c.issuedAt)} · {c.code}</p>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">Feedbacks e recomendações</h2>
          {data.feedback.length === 0 ? (
            <p className="text-sm text-muted">Os feedbacks do seu líder aparecerão aqui.</p>
          ) : (
            <ul className="space-y-2">
              {data.feedback.map((f) => (
                <li key={f.id}>
                  <Card className="p-4 text-sm">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge tone="primary">{FEEDBACK_KIND_LABEL[f.kind]}</Badge>
                      <span className="text-xs text-muted">{f.author ?? "Líder"} · {relativeTime(f.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-line">{f.body}</p>
                    {f.trackTitle && <p className="mt-1 text-xs text-muted">Trilha: {f.trackTitle}</p>}
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export function CertificatePage() {
  const { code = "" } = useParams();
  const { branding } = useBranding();
  const { data, isLoading } = useApi<{ found: boolean; code?: string; issuedAt?: string; trackTitle?: string; name?: string }>(`/api/certificates/${encodeURIComponent(code)}`);
  useDocumentTitle("Certificado");
  if (isLoading) return <PageLoader />;
  if (!data?.found) return <EmptyState title="Certificado não encontrado" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" icon={Printer} onClick={() => window.print()}>Imprimir certificado</Button>
      </div>
      <Card className="relative overflow-hidden p-10 text-center sm:p-14">
        <div className="absolute inset-x-0 top-0 h-2 bg-primary" aria-hidden />
        <Brand size="md" className="justify-center" />
        <p className="mt-10 text-sm uppercase tracking-[0.3em] text-muted">Certificado de conclusão</p>
        <p className="mt-6 text-muted">Certificamos que</p>
        <p className="mt-2 font-heading text-3xl font-bold">{data.name}</p>
        <p className="mt-4 text-muted">concluiu a trilha de formação</p>
        <p className="mt-2 font-heading text-2xl font-semibold text-primary">{data.trackTitle}</p>
        <p className="mt-8 text-sm text-muted">
          {branding.organizationName} · emitido em {formatDate(data.issuedAt)} · código {data.code}
        </p>
        <p className="mt-4 text-xs text-muted">Este certificado atesta a conclusão de uma trilha interna de capacitação e não substitui certificações ou habilitações profissionais exigidas por órgãos reguladores.</p>
      </Card>
    </div>
  );
}
