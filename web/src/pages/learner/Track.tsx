import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Award,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ClipboardCheck,
  Clock,
  ExternalLink,
  FileText,
  Hammer,
  Layers,
  Lock,
  PlayCircle,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Video,
} from "lucide-react";
import { ASSESSMENT_KIND_LABEL, LEVEL_LABEL, PRACTICE_STAGE_LABEL, TRACK_MODE_LABEL, type AssessmentKind, type LearnerTrackStatus, type Level, type PracticeStage, type TrackMode } from "../../../../shared/domain";
import { DueBadge, PillarsView, StatusBadge, TrackCover, type Pillars } from "../../components/learning";
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Field, Modal, PageLoader, Progress, Textarea, cx } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatDate, formatMinutes } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { NotFoundPage } from "../Errors";
import { nextLink } from "./Dashboard";

interface ContentView {
  id: string;
  title: string;
  type: string;
  description: string;
  isRequired: boolean;
  estimatedMinutes: number;
  pageCount: number;
  status: "not_started" | "in_progress" | "completed";
  percent: number;
  lastPage: number;
  locked: boolean;
  lockReason: string | null;
  available: boolean;
  draft: boolean;
}
interface AssessmentView {
  id: string;
  title: string;
  kind: AssessmentKind;
  isRequired: boolean;
  passingScore: number;
  maxAttempts: number | null;
  attemptsUsed: number;
  bestScore: number | null;
  status: "not_started" | "in_progress" | "pending_review" | "passed" | "failed" | "failed_final";
  locked: boolean;
  draft: boolean;
}
interface ActivityView {
  id: string;
  title: string;
  stage: PracticeStage;
  competency: string;
  isRequired: boolean;
  status: "not_submitted" | "submitted" | "approved" | "rejected" | "returned";
  done: boolean;
  locked: boolean;
  draft: boolean;
}
export interface ModuleView {
  id: string;
  code: string | null;
  title: string;
  description: string;
  objectives: string;
  locked: boolean;
  lockReason: string | null;
  status: "not_started" | "in_progress" | "completed";
  percent: number;
  estimatedMinutes: number;
  contents: ContentView[];
  assessments: AssessmentView[];
  activities: ActivityView[];
  draft: boolean;
}
interface TrackView {
  status: LearnerTrackStatus;
  percent: number;
  estimatedMinutes: number;
  remainingMinutes: number;
  pillars: Pillars;
  validation: { required: boolean; status: "none" | "approved" | "rejected"; comment: string | null };
  modules: ModuleView[];
  finalAssessments: AssessmentView[];
  next: { kind: "content" | "assessment" | "activity"; id: string; title: string; moduleId: string | null } | null;
}
type TrackResponse =
  | { locked: true; track: { id: string; title: string; summary: string; description: string; level: Level; mode: TrackMode }; canRequestAccess: boolean; pendingRequest: boolean }
  | {
      locked: false;
      preview: boolean;
      partial: boolean;
      track: {
        id: string;
        title: string;
        summary: string;
        description: string;
        objectives: string;
        prerequisites: string;
        specialty: string;
        level: Level;
        mode: TrackMode;
        status: string;
        ownerName: string;
        isRampUp: boolean;
        rampDays: number | null;
        requiresLeaderValidation: boolean;
        certificateEnabled: boolean;
        coverColor: string;
        dependsOn: { id: string; title: string } | null;
      };
      area: { id: string; name: string; slug: string; color: string; icon: string };
      enrollment: { isMandatory: boolean; dueDate: string | null; source: string; startedAt: string | null; completedAt: string | null } | null;
      isMandatory: boolean;
      certificate: { code: string; issuedAt: string } | null;
      trackLock: { locked: boolean; reason: string | null };
      view: TrackView;
    };

const contentIcon = (type: string) => (type === "video" ? Video : type === "link" ? ExternalLink : FileText);

function ItemStatus({ done, inProgress, label }: { done: boolean; inProgress?: boolean; label?: string }) {
  if (done) return <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-label={label ?? "Concluído"} />;
  if (inProgress) return <CircleDashed className="h-5 w-5 shrink-0 text-primary" aria-label={label ?? "Em andamento"} />;
  return <span className="h-5 w-5 shrink-0 rounded-full border-2 border-border" aria-label={label ?? "Não iniciado"} />;
}

export const assessmentStatusLabel: Record<AssessmentView["status"], string> = {
  not_started: "Não iniciada",
  in_progress: "Em andamento",
  pending_review: "Aguardando correção",
  passed: "Aprovado",
  failed: "Reprovado — nova tentativa disponível",
  failed_final: "Reprovado — sem tentativas",
};
export const activityStatusLabel: Record<ActivityView["status"], string> = {
  not_submitted: "Não enviada",
  submitted: "Aguardando avaliação",
  approved: "Aprovada",
  rejected: "Reprovada",
  returned: "Devolvida para ajustes",
};

function ItemRow({ to, icon: Icon, title, meta, locked, lockReason, status, draft }: { to: string; icon: typeof FileText; title: string; meta: React.ReactNode; locked: boolean; lockReason?: string | null; status: React.ReactNode; draft?: boolean }) {
  const inner = (
    <>
      <span className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg", locked ? "bg-subtle text-muted" : "bg-primary/10 text-primary")}>
        {locked ? <Lock className="h-4 w-4" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {title}
          {draft && <Badge tone="warning">Rascunho</Badge>}
        </p>
        <p className="text-xs text-muted">{locked && lockReason ? lockReason : meta}</p>
      </div>
      {status}
    </>
  );
  if (locked) return <li className="flex items-center gap-3 rounded-xl px-2 py-2.5 opacity-70">{inner}</li>;
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-subtle">
        {inner}
      </Link>
    </li>
  );
}

export function ModuleItems({ m }: { m: ModuleView }) {
  return (
    <ul className="space-y-0.5">
      {m.contents.map((c) => (
        <ItemRow
          key={c.id}
          to={`/conteudos/${c.id}${c.status === "in_progress" ? `?pagina=${c.lastPage}` : ""}`}
          icon={contentIcon(c.type)}
          title={c.title}
          draft={c.draft}
          locked={c.locked || !c.available}
          lockReason={!c.available ? "Em processamento" : c.lockReason}
          meta={[c.type === "document" && c.pageCount ? `${c.pageCount} páginas` : null, c.estimatedMinutes ? formatMinutes(c.estimatedMinutes) : null, c.isRequired ? null : "Opcional", c.status === "in_progress" ? `${c.percent}% lido` : null]
            .filter(Boolean)
            .join(" · ")}
          status={<ItemStatus done={c.status === "completed"} inProgress={c.status === "in_progress"} />}
        />
      ))}
      {m.assessments.map((a) => (
        <ItemRow
          key={a.id}
          to={`/avaliacoes/${a.id}`}
          icon={ClipboardCheck}
          title={a.title}
          draft={a.draft}
          locked={a.locked}
          lockReason="Conclua os conteúdos obrigatórios do módulo para liberar."
          meta={`${ASSESSMENT_KIND_LABEL[a.kind]} · nota mínima ${a.passingScore}% · ${assessmentStatusLabel[a.status]}${a.bestScore !== null ? ` · melhor nota ${a.bestScore}%` : ""}`}
          status={<ItemStatus done={a.status === "passed"} inProgress={["in_progress", "pending_review", "failed"].includes(a.status)} />}
        />
      ))}
      {m.activities.map((a) => (
        <ItemRow
          key={a.id}
          to={`/atividades/${a.id}`}
          icon={a.stage === "execute" ? Hammer : Sparkles}
          title={a.title}
          draft={a.draft}
          locked={a.locked}
          lockReason="Conclua os conteúdos obrigatórios do módulo para liberar."
          meta={`${a.stage === "execute" ? "Execute" : "Demonstre"} · ${activityStatusLabel[a.status]}`}
          status={<ItemStatus done={a.done} inProgress={a.status === "submitted"} />}
        />
      ))}
      {!m.contents.length && !m.assessments.length && !m.activities.length && <li className="px-2 py-3 text-sm text-muted">Conteúdo em preparação.</li>}
    </ul>
  );
}

function RequestAccess({ trackId, pending }: { trackId: string; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const send = useAction(() => api.post("/api/requests", { type: "access", trackId, message }), {
    invalidate: [`/api/tracks/${trackId}`],
    success: "Solicitação enviada ao administrador e aos líderes da área.",
    onSuccess: () => setOpen(false),
  });
  if (pending) return <Badge tone="info">Solicitação de acesso em análise</Badge>;
  return (
    <>
      <Button icon={Send} onClick={() => setOpen(true)}>
        Solicitar acesso
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Solicitar acesso à trilha"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={send.isPending} onClick={() => send.mutate(undefined)}>Enviar solicitação</Button>
          </>
        }
      >
        <Field label="Por que você precisa desta trilha? (opcional)" htmlFor="req-msg">
          <Textarea id="req-msg" value={message} maxLength={3000} onChange={(e) => setMessage(e.target.value)} placeholder="Ex.: vou atuar com clientes de consórcio a partir do próximo mês." />
        </Field>
      </Modal>
    </>
  );
}

export function TrackPage() {
  const { id = "" } = useParams();
  const { data, isLoading, error, refetch } = useApi<TrackResponse>(`/api/tracks/${id}`);
  const [openModules, setOpenModules] = useState<Record<string, boolean>>({});
  useDocumentTitle(data?.track.title);
  const start = useAction(() => api.post<{ next: TrackView["next"] }>(`/api/tracks/${id}/start`), { invalidate: [`/api/tracks/${id}`, "/api/dashboard"] });

  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  if (data.locked) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link to="/trilhas" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Catálogo
        </Link>
        <Card className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-subtle text-muted">
              <Lock className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <Badge>{TRACK_MODE_LABEL[data.track.mode]} · {LEVEL_LABEL[data.track.level]}</Badge>
              <h1 className="mt-1 font-heading text-2xl font-bold">{data.track.title}</h1>
            </div>
          </div>
          <p className="mt-4 text-muted">{data.track.summary}</p>
          {data.track.description && <p className="mt-3 whitespace-pre-line">{data.track.description}</p>}
          <Alert tone="warning" title="Você ainda não tem acesso a esta trilha" icon={Lock}>
            O conteúdo é liberado pelo administrador ou pelo líder da área conforme cargo, área e plano de desenvolvimento.
          </Alert>
          {data.canRequestAccess && (
            <div className="mt-5">
              <RequestAccess trackId={data.track.id} pending={data.pendingRequest} />
            </div>
          )}
        </Card>
      </div>
    );
  }

  const { track, area, view } = data;
  const due = data.enrollment?.dueDate ?? null;
  const toggle = (mid: string) => setOpenModules((s) => ({ ...s, [mid]: !(s[mid] ?? true) }));

  return (
    <div className="space-y-6">
      <Link to="/trilhas" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Catálogo de trilhas
      </Link>
      {data.preview && <Alert tone="info" title="Modo de pré-visualização" icon={ShieldCheck}>Você está vendo itens em rascunho por ser administrador ou líder com permissão de edição nesta área.</Alert>}
      {data.trackLock.locked && <Alert tone="warning" title="Trilha bloqueada" icon={Lock}>{data.trackLock.reason}</Alert>}

      <Card className="overflow-hidden">
        <TrackCover color={track.coverColor} icon={area.icon} className="px-6 pb-6 pt-8 text-white sm:px-8">
          <p className="text-sm font-medium text-white/80">{area.name}</p>
          <h1 className="mt-1 max-w-3xl font-heading text-2xl font-bold sm:text-3xl">{track.title}</h1>
          {track.summary && <p className="mt-2 max-w-3xl text-white/85">{track.summary}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {data.isMandatory && <span className="rounded-full bg-black/30 px-2.5 py-1 text-xs font-semibold">Obrigatória</span>}
            <span className="rounded-full bg-black/30 px-2.5 py-1 text-xs">{TRACK_MODE_LABEL[track.mode]}</span>
            <span className="rounded-full bg-black/30 px-2.5 py-1 text-xs">Nível {LEVEL_LABEL[track.level].toLowerCase()}</span>
            {track.isRampUp && <span className="rounded-full bg-black/30 px-2.5 py-1 text-xs">Rampagem de {track.rampDays ?? 7} dias</span>}
            {track.certificateEnabled && <span className="rounded-full bg-black/30 px-2.5 py-1 text-xs">Com certificado</span>}
            {track.requiresLeaderValidation && <span className="rounded-full bg-black/30 px-2.5 py-1 text-xs">Validação do líder</span>}
          </div>
        </TrackCover>
        <div className="grid gap-5 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={view.status} />
              <DueBadge due={due} done={view.status === "completed"} />
              {data.partial && <Badge tone="info">Acesso parcial</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <Progress value={view.percent} className="max-w-md" label="Progresso na trilha" />
              <span className="text-sm font-medium">{view.percent}%</span>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
              <span className="inline-flex items-center gap-1"><Layers className="h-4 w-4" aria-hidden /> {view.modules.length} módulo(s)</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4" aria-hidden /> Carga estimada: {formatMinutes(view.estimatedMinutes)}</span>
              {view.remainingMinutes > 0 && <span>Restante: {formatMinutes(view.remainingMinutes)}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.certificate && (
              <Link to={`/certificados/${data.certificate.code}`}>
                <Button variant="outline" icon={Award}>Certificado</Button>
              </Link>
            )}
            {view.next && !data.trackLock.locked && (
              <Link to={nextLink(view.next)} onClick={() => view.status === "not_started" && start.mutate(undefined)}>
                <Button size="lg" glow icon={PlayCircle}>
                  {view.status === "not_started" ? "Começar trilha" : "Continuar"}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-heading text-lg font-semibold">Sua evolução nesta trilha</h2>
        <PillarsView pillars={view.pillars} validation={view.validation} />
        {view.validation.status === "rejected" && view.validation.comment && <p className="mt-3 text-sm text-danger">Comentário do líder: {view.validation.comment}</p>}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold">Módulos</h2>
          {view.modules.map((m, i) => {
            const open = openModules[m.id] ?? (m.status !== "completed" && !m.locked);
            return (
              <Card key={m.id} className="overflow-hidden">
                <button className="flex w-full items-center gap-4 px-5 py-4 text-left" aria-expanded={open} onClick={() => toggle(m.id)}>
                  <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-xl font-heading font-bold", m.status === "completed" ? "bg-success/15 text-success" : m.locked ? "bg-subtle text-muted" : "bg-primary/12 text-primary")}>
                    {m.locked ? <Lock className="h-4 w-4" aria-hidden /> : m.code ?? i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {m.title}
                      {m.draft && <Badge tone="warning">Rascunho</Badge>}
                    </p>
                    <p className="text-xs text-muted">{m.locked ? m.lockReason : `${m.percent}% · ${formatMinutes(m.estimatedMinutes)}`}</p>
                  </div>
                  <Link to={`/modulos/${m.id}`} onClick={(e) => e.stopPropagation()} className="hidden text-sm text-primary hover:underline sm:block">
                    Detalhes
                  </Link>
                  <ChevronDown className={cx("h-5 w-5 text-muted transition", open && "rotate-180")} aria-hidden />
                </button>
                {open && (
                  <div className="border-t border-border px-3 py-2">
                    {m.description && <p className="px-2 pb-2 pt-1 text-sm text-muted">{m.description}</p>}
                    <ModuleItems m={m} />
                  </div>
                )}
              </Card>
            );
          })}
          {view.modules.length === 0 && <Card className="p-6 text-sm text-muted">Esta trilha está em preparação. Os módulos serão publicados em breve.</Card>}
          {view.finalAssessments.length > 0 && (
            <Card>
              <CardHeader title="Avaliação final" icon={Target} />
              <div className="px-3 py-2">
                <ModuleItems m={{ id: "final", code: null, title: "", description: "", objectives: "", locked: false, lockReason: null, status: "not_started", percent: 0, estimatedMinutes: 0, contents: [], activities: [], assessments: view.finalAssessments, draft: false }} />
              </div>
            </Card>
          )}
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <h2 className="font-heading text-base font-semibold">Apresentação</h2>
            {track.description && <p className="mt-2 whitespace-pre-line text-sm text-muted">{track.description}</p>}
            {track.objectives && (
              <>
                <h3 className="mt-4 text-sm font-semibold">Objetivos</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-muted">{track.objectives}</p>
              </>
            )}
            <h3 className="mt-4 text-sm font-semibold">Pré-requisitos</h3>
            <p className="mt-1 text-sm text-muted">{track.dependsOn ? `Concluir “${track.dependsOn.title}”. ` : ""}{track.prerequisites || (track.dependsOn ? "" : "Nenhum.")}</p>
            {track.ownerName && <p className="mt-4 text-xs text-muted">Responsável: {track.ownerName}</p>}
          </Card>
          {data.enrollment && (
            <Card className="p-5 text-sm">
              <h2 className="font-heading text-base font-semibold">Sua matrícula</h2>
              <ul className="mt-2 space-y-1 text-muted">
                <li>Início: {formatDate(data.enrollment.startedAt)}</li>
                {data.enrollment.dueDate && <li>Prazo: {formatDate(data.enrollment.dueDate)}</li>}
                {data.enrollment.completedAt && <li>Conclusão: {formatDate(data.enrollment.completedAt)}</li>}
              </ul>
            </Card>
          )}
          <Card className="p-5 text-sm text-muted">
            <p className="flex items-center gap-2 font-medium text-fg"><BookOpen className="h-4 w-4 text-primary" aria-hidden /> Aprender, praticar e executar</p>
            <p className="mt-2">Cada módulo segue: Aprenda (conteúdos), Entenda (fixação), Demonstre (simulação/caso), Execute (atividade acompanhada) e Valide (feedback do líder).</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

const STEPS: { key: string; title: string; description: string; icon: typeof BookOpen }[] = [
  { key: "learn", title: "Aprenda", description: "Leia ou assista ao conteúdo.", icon: BookOpen },
  { key: "understand", title: "Entenda", description: "Responda às perguntas de fixação.", icon: ClipboardCheck },
  { key: "demonstrate", title: "Demonstre", description: "Realize uma simulação ou estudo de caso.", icon: Sparkles },
  { key: "execute", title: "Execute", description: "Aplique a competência numa atividade acompanhada.", icon: Hammer },
  { key: "validate", title: "Valide", description: "Receba feedback ou aprovação do líder.", icon: ShieldCheck },
];

interface ModuleResponse {
  preview: boolean;
  module: ModuleView & { requiresPrevious: boolean };
  track: { id: string; title: string; areaName: string; areaColor: string };
  prev: { id: string; title: string } | null;
  next: { id: string; title: string; locked: boolean } | null;
  trackStatus: LearnerTrackStatus;
}

export function ModulePage() {
  const { id = "" } = useParams();
  const { data, isLoading, error, refetch } = useApi<ModuleResponse>(`/api/modules/${id}`);
  useDocumentTitle(data?.module.title);
  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const m = data.module;
  const pick = (key: string): ModuleView => {
    const base = { ...m, contents: [] as ContentView[], assessments: [] as AssessmentView[], activities: [] as ActivityView[] };
    if (key === "learn") return { ...base, contents: m.contents };
    if (key === "understand") return { ...base, assessments: m.assessments.filter((a) => a.kind === "fixation" || a.kind === "final") };
    if (key === "demonstrate") return { ...base, assessments: m.assessments.filter((a) => a.kind === "case_study" || a.kind === "simulation"), activities: m.activities.filter((a) => a.stage === "demonstrate") };
    if (key === "execute") return { ...base, activities: m.activities.filter((a) => a.stage === "execute") };
    return base;
  };
  const practical = m.activities;
  return (
    <div className="space-y-6">
      <Link to={`/trilhas/${data.track.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {data.track.title}
      </Link>
      <header>
        <p className="text-sm font-medium" style={{ color: data.track.areaColor }}>
          {data.track.areaName} · Módulo {m.code ?? ""}
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold sm:text-3xl">{m.title}</h1>
        {m.description && <p className="mt-2 max-w-3xl text-muted">{m.description}</p>}
        <div className="mt-3 flex max-w-md items-center gap-3">
          <Progress value={m.percent} label="Progresso no módulo" />
          <span className="text-sm font-medium">{m.percent}%</span>
        </div>
      </header>
      {m.locked && <Alert tone="warning" title="Módulo bloqueado" icon={Lock}>{m.lockReason}</Alert>}
      {m.objectives && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Objetivos de aprendizagem</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-muted">{m.objectives}</p>
        </Card>
      )}
      <ol className="space-y-4">
        {STEPS.map((step, i) => {
          const sub = pick(step.key);
          const empty = !sub.contents.length && !sub.assessments.length && !sub.activities.length;
          return (
            <li key={step.key}>
              <Card>
                <div className="flex items-start gap-4 px-5 pt-5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 font-heading font-bold text-primary">{i + 1}</span>
                  <div>
                    <h2 className="flex items-center gap-2 font-heading text-lg font-semibold">
                      <step.icon className="h-4 w-4 text-primary" aria-hidden /> {step.title}
                    </h2>
                    <p className="text-sm text-muted">{step.description}</p>
                  </div>
                </div>
                <div className="px-3 pb-3 pt-2">
                  {step.key === "validate" ? (
                    <div className="px-2 py-2 text-sm text-muted">
                      {practical.length === 0
                        ? "Este módulo não possui atividades com validação."
                        : practical.map((a) => (
                            <p key={a.id} className="flex items-center gap-2 py-1">
                              <ItemStatus done={a.status === "approved"} inProgress={a.status === "submitted"} />
                              {a.title}: <strong className="text-fg">{activityStatusLabel[a.status]}</strong>
                            </p>
                          ))}
                    </div>
                  ) : empty ? (
                    <p className="px-2 py-2 text-sm text-muted">Nenhum item nesta etapa.</p>
                  ) : (
                    <ModuleItems m={sub} />
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col justify-between gap-3 sm:flex-row">
        {data.prev ? (
          <Link to={`/modulos/${data.prev.id}`}>
            <Button variant="outline" icon={ArrowLeft}>{data.prev.title}</Button>
          </Link>
        ) : <span />}
        {data.next && (
          <Link to={`/modulos/${data.next.id}`}>
            <Button variant="outline" icon={data.next.locked ? Lock : ArrowRight}>Próximo: {data.next.title}</Button>
          </Link>
        )}
      </div>
      <p className="text-xs text-muted">{PRACTICE_STAGE_LABEL.execute}: atividades reais acompanhadas pelo líder, que pode aprovar, reprovar ou devolver com comentários.</p>
    </div>
  );
}
