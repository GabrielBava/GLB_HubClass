import { Link } from "react-router";
import { Award, BookOpen, CalendarClock, ClipboardList, Clock, MessageSquareQuote, PlayCircle, Sparkles, Target, Timer } from "lucide-react";
import { DueBadge, StatusBadge } from "../../components/learning";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageLoader, Progress, ProgressRing, cx } from "../../components/ui";
import { LIBRARY_TYPE_LABEL, type LearnerTrackStatus, type LibraryType } from "../../../../shared/domain";
import { formatDate, formatMinutes, greeting, relativeTime } from "../../lib/format";
import { useApi, useDocumentTitle } from "../../lib/hooks";

interface TrackItem {
  id: string;
  title: string;
  areaName: string;
  areaColor: string;
  status: LearnerTrackStatus;
  percent: number;
  remainingMinutes: number;
  estimatedMinutes: number;
  isMandatory: boolean;
  dueDate: string | null;
  overdue: boolean;
}

interface DashboardData {
  user: { name: string; jobTitle: string | null; department: string | null };
  summary: { overallPercent: number; inProgress: number; completed: number; mandatoryPending: number; remainingMinutes: number; certificates: number };
  continue: { contentId: string; title: string; type: string; trackTitle: string; trackId: string; lastPage: number; percent: number } | null;
  lastAccessed: { contentId: string; title: string; trackTitle: string; updatedAt: string } | null;
  next: { kind: "content" | "assessment" | "activity"; id: string; title: string; trackId: string; trackTitle: string } | null;
  inProgress: TrackItem[];
  mandatory: TrackItem[];
  deadlines: TrackItem[];
  pendingAssessments: { id: string; title: string; status: string; trackId: string; trackTitle: string }[];
  recentContents: { id: string; title: string; publishedAt: string; trackTitle: string; trackId: string }[];
  certificates: { code: string; issuedAt: string; trackTitle: string; trackId: string }[];
  feedback: { id: string; kind: string; body: string; author: string | null; createdAt: string }[];
  reading: { id: string; title: string; author: string; type: LibraryType; coverColor: string | null; estimatedMinutes: number | null }[];
}

export const nextLink = (n: { kind: string; id: string }) => (n.kind === "content" ? `/conteudos/${n.id}` : n.kind === "assessment" ? `/avaliacoes/${n.id}` : `/atividades/${n.id}`);
const nextLabel: Record<string, string> = { content: "Leitura", assessment: "Avaliação", activity: "Atividade prática" };

function TrackRow({ t }: { t: TrackItem }) {
  return (
    <li>
      <Link to={`/trilhas/${t.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-subtle">
        <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: t.areaColor }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{t.title}</p>
            {t.isMandatory && <Badge tone="warning">Obrigatória</Badge>}
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <Progress value={t.percent} size="sm" className="max-w-[220px]" label={`Progresso em ${t.title}`} />
            <span className="text-xs text-muted">{t.percent}%</span>
          </div>
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
          <StatusBadge status={t.status} />
          {t.dueDate && t.status !== "completed" ? <DueBadge due={t.dueDate} /> : t.remainingMinutes > 0 && <span className="text-xs text-muted">{formatMinutes(t.remainingMinutes)} restantes</span>}
        </div>
      </Link>
    </li>
  );
}

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useApi<DashboardData>("/api/dashboard");
  useDocumentTitle("Início");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const firstName = data.user.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">{[data.user.jobTitle, data.user.department].filter(Boolean).join(" · ") || "Colaborador"}</p>
        <h1 className="font-heading text-3xl font-medium sm:text-[34px]">
          {greeting()}, {firstName}!
        </h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="relative overflow-hidden lg:col-span-2">
          <div className="brand-backdrop dark absolute inset-0" aria-hidden />
          <div className="dark relative flex h-full flex-col justify-between gap-6 p-6 pl-8 text-white sm:p-7 sm:pl-9">
            {data.continue ? (
              <>
                <div>
                  <p className="eyebrow">Continuar de onde parei</p>
                  <h2 className="mt-2 font-heading text-[28px] font-medium leading-tight">{data.continue.title}</h2>
                  <p className="mt-1 text-sm text-white/65">
                    {data.continue.trackTitle} · página {data.continue.lastPage} · {data.continue.percent}% lido
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link to={`/conteudos/${data.continue.contentId}?pagina=${data.continue.lastPage}`}>
                    <Button size="lg" glow icon={PlayCircle}>
                      Continuar de onde parei
                    </Button>
                  </Link>
                  <div className="w-40">
                    <Progress value={data.continue.percent} label="Progresso da leitura" />
                  </div>
                </div>
              </>
            ) : data.next ? (
              <>
                <div>
                  <p className="eyebrow">Próxima atividade recomendada</p>
                  <h2 className="mt-2 font-heading text-[28px] font-medium leading-tight">{data.next.title}</h2>
                  <p className="mt-1 text-sm text-white/65">
                    {nextLabel[data.next.kind]} · {data.next.trackTitle}
                  </p>
                </div>
                <Link to={nextLink(data.next)}>
                  <Button size="lg" glow icon={PlayCircle}>
                    Começar
                  </Button>
                </Link>
              </>
            ) : (
              <div>
                <p className="eyebrow">Seu ambiente de aprendizado</p>
                <h2 className="mt-2 font-heading text-[28px] font-medium leading-tight">Explore o catálogo de trilhas</h2>
                <p className="mt-1 text-sm text-white/65">Quando você iniciar um conteúdo, ele aparecerá aqui para retomar.</p>
                <Link to="/trilhas" className="mt-5 inline-block">
                  <Button size="lg" glow icon={BookOpen}>
                    Ver trilhas
                  </Button>
                </Link>
              </div>
            )}
          </div>
        </Card>

        <Card className="flex items-center gap-5 p-6">
          <ProgressRing value={data.summary.overallPercent} size={104} label={`Evolução geral: ${data.summary.overallPercent}%`} />
          <div className="space-y-1.5 text-sm">
            <p className="font-heading text-base font-semibold">Evolução geral</p>
            <p className="text-muted">
              <strong className="text-fg">{data.summary.inProgress}</strong> em andamento · <strong className="text-fg">{data.summary.completed}</strong> concluídas
            </p>
            <p className="flex items-center gap-1.5 text-muted">
              <Clock className="h-4 w-4" aria-hidden /> {formatMinutes(data.summary.remainingMinutes)} restantes (estimado)
            </p>
            {data.summary.mandatoryPending > 0 && (
              <p className="flex items-center gap-1.5 text-warning">
                <Target className="h-4 w-4" aria-hidden /> {data.summary.mandatoryPending} obrigatória(s) pendente(s)
              </p>
            )}
          </div>
        </Card>
      </div>

      {data.next && data.continue && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Próxima atividade recomendada</p>
              <p className="font-medium">
                {data.next.title} <span className="text-muted">· {nextLabel[data.next.kind]} em {data.next.trackTitle}</span>
              </p>
            </div>
          </div>
          <Link to={nextLink(data.next)}>
            <Button variant="outline">Ir para a atividade</Button>
          </Link>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Trilhas obrigatórias" description="Definidas para o seu cargo e área" icon={Target} action={<Link to="/trilhas?obrigatoria=1" className="text-sm text-primary hover:underline">Ver todas</Link>} />
            <div className="p-3">
              {data.mandatory.length ? <ul>{data.mandatory.map((t) => <TrackRow key={t.id} t={t} />)}</ul> : <p className="px-2 py-4 text-sm text-muted">Nenhuma trilha obrigatória no momento.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Em andamento" icon={BookOpen} />
            <div className="p-3">
              {data.inProgress.length ? (
                <ul>{data.inProgress.map((t) => <TrackRow key={t.id} t={t} />)}</ul>
              ) : (
                <EmptyState title="Nenhuma trilha em andamento" description="Comece pelas obrigatórias ou explore o catálogo." action={<Link to="/trilhas"><Button variant="outline" size="sm">Catálogo de trilhas</Button></Link>} />
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Conteúdos publicados recentemente" icon={Sparkles} />
            <ul className="p-3">
              {data.recentContents.map((c) => (
                <li key={c.id}>
                  <Link to={`/conteudos/${c.id}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 hover:bg-subtle">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.title}</span>
                      <span className="block truncate text-xs text-muted">{c.trackTitle}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted">{formatDate(c.publishedAt)}</span>
                  </Link>
                </li>
              ))}
              {!data.recentContents.length && <li className="px-2 py-4 text-sm text-muted">Nada novo nas suas trilhas nos últimos dias.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Prazos" icon={CalendarClock} />
            <ul className="space-y-1 p-3">
              {data.deadlines.map((t) => (
                <li key={t.id}>
                  <Link to={`/trilhas/${t.id}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-subtle">
                    <span className="truncate text-sm font-medium">{t.title}</span>
                    <span className={cx("shrink-0 text-xs font-medium", t.overdue ? "text-danger" : "text-muted")}>{t.overdue ? "Atrasada" : formatDate(t.dueDate)}</span>
                  </Link>
                </li>
              ))}
              {!data.deadlines.length && <li className="px-2 py-3 text-sm text-muted">Sem prazos definidos.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Avaliações pendentes" icon={ClipboardList} />
            <ul className="space-y-1 p-3">
              {data.pendingAssessments.map((a) => (
                <li key={a.id}>
                  <Link to={`/avaliacoes/${a.id}`} className="block rounded-xl px-2 py-2 hover:bg-subtle">
                    <span className="block truncate text-sm font-medium">{a.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {a.trackTitle}
                      {a.status === "pending_review" ? " · aguardando correção" : a.status === "failed" ? " · nova tentativa disponível" : ""}
                    </span>
                  </Link>
                </li>
              ))}
              {!data.pendingAssessments.length && <li className="px-2 py-3 text-sm text-muted">Nenhuma avaliação pendente.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Certificados" icon={Award} />
            <ul className="space-y-1 p-3">
              {data.certificates.map((c) => (
                <li key={c.code}>
                  <Link to={`/certificados/${c.code}`} className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-subtle">
                    <span className="truncate text-sm font-medium">{c.trackTitle}</span>
                    <span className="text-xs text-muted">{formatDate(c.issuedAt)}</span>
                  </Link>
                </li>
              ))}
              {!data.certificates.length && <li className="px-2 py-3 text-sm text-muted">Conclua trilhas certificadas para conquistar certificados.</li>}
            </ul>
          </Card>
          {data.feedback.length > 0 && (
            <Card>
              <CardHeader title="Feedback do líder" icon={MessageSquareQuote} />
              <ul className="space-y-3 p-5 pt-3">
                {data.feedback.slice(0, 3).map((f) => (
                  <li key={f.id} className="rounded-xl bg-subtle p-3 text-sm">
                    <p>{f.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {f.author ?? "Líder"} · {relativeTime(f.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Recomendações de leitura" icon={BookOpen} action={<Link to="/biblioteca" className="text-sm text-primary hover:underline">Biblioteca</Link>} />
            <ul className="space-y-2 p-5 pt-3">
              {data.reading.map((r) => (
                <li key={r.id} className="flex items-center gap-3">
                  <span className="h-10 w-8 shrink-0 rounded" style={{ background: r.coverColor ?? "var(--accent)" }} aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-muted">
                      {r.author} · {LIBRARY_TYPE_LABEL[r.type]}
                      {r.estimatedMinutes ? ` · ${formatMinutes(r.estimatedMinutes)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          {data.lastAccessed && (
            <p className="flex items-center gap-1.5 px-1 text-xs text-muted">
              <Timer className="h-3.5 w-3.5" aria-hidden /> Último conteúdo acessado: {data.lastAccessed.title} ({relativeTime(data.lastAccessed.updatedAt)})
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
