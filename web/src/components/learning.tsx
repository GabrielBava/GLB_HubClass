import { Link } from "react-router";
import { BookOpenCheck, CheckCircle2, Clock, Layers, Lock, ShieldCheck, Sparkles, Target, Timer, Wrench, type LucideIcon } from "lucide-react";
import { LEARNER_TRACK_STATUS_LABEL, LEVEL_LABEL, TRACK_MODE_LABEL, type LearnerTrackStatus, type Level, type TrackMode } from "../../../shared/domain";
import { formatMinutes, formatDate, daysUntil } from "../lib/format";
import { AreaIcon } from "./AreaIcon";
import { Badge, Card, Progress, cx } from "./ui";

const statusTone: Record<LearnerTrackStatus, "neutral" | "primary" | "warning" | "info" | "success" | "danger"> = {
  not_started: "neutral",
  in_progress: "primary",
  pending_assessment: "warning",
  pending_validation: "info",
  completed: "success",
  needs_revision: "danger",
};

export function StatusBadge({ status }: { status: LearnerTrackStatus }) {
  return <Badge tone={statusTone[status]}>{LEARNER_TRACK_STATUS_LABEL[status]}</Badge>;
}

export function DueBadge({ due, done }: { due: string | null; done?: boolean }) {
  if (!due || done) return null;
  const d = daysUntil(due)!;
  if (d < 0) return <Badge tone="danger" icon={Timer}>Atrasada desde {formatDate(due)}</Badge>;
  if (d <= 7) return <Badge tone="warning" icon={Timer}>Prazo: {formatDate(due)}</Badge>;
  return <Badge icon={Timer}>Prazo: {formatDate(due)}</Badge>;
}

export interface TrackCardData {
  id: string;
  title: string;
  summary: string;
  area: { name: string; color: string; icon: string };
  level: Level;
  mode: TrackMode;
  moduleCount: number;
  estimatedMinutes: number;
  coverColor: string;
  access: "full" | "partial" | "none";
  availability: "available" | "locked" | "blocked";
  isMandatory: boolean;
  isRampUp?: boolean;
  rampDays?: number | null;
  prerequisites?: string;
  dependsOn?: { title: string } | null;
  progress: { status: LearnerTrackStatus; percent: number; dueDate: string | null };
}

export function TrackCover({ color, icon, className, children }: { color: string; icon: string; className?: string; children?: React.ReactNode }) {
  return (
    <div
      className={cx("relative overflow-hidden", className)}
      style={{ background: `linear-gradient(135deg, ${color} 0%, color-mix(in oklab, ${color} 55%, #050807) 100%)` }}
    >
      <AreaIcon name={icon} className="absolute -right-4 -bottom-6 h-28 w-28 text-white/15" />
      {children}
    </div>
  );
}

export function TrackCard({ t }: { t: TrackCardData }) {
  const locked = t.availability !== "available";
  return (
    <Card as="article" className="group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lg">
      <Link to={`/trilhas/${t.id}`} className="flex flex-1 flex-col focus:outline-none" aria-label={`${t.title}${locked ? " (bloqueada)" : ""}`}>
        <TrackCover color={t.coverColor} icon={t.area.icon} className="h-28 p-4">
          <div className="flex flex-wrap gap-1.5">
            {t.isMandatory && <span className="rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-semibold text-white">Obrigatória</span>}
            {t.isRampUp && <span className="rounded-full bg-black/35 px-2 py-0.5 text-[11px] font-semibold text-white">Rampagem {t.rampDays ?? 7} dias</span>}
          </div>
          {locked && (
            <span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white" title="Bloqueada">
              <Lock className="h-4 w-4" aria-hidden />
            </span>
          )}
        </TrackCover>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="text-xs font-medium text-muted">{t.area.name}</p>
          <h3 className="font-heading text-base font-semibold leading-snug group-hover:text-primary">{t.title}</h3>
          {t.summary && <p className="line-clamp-2 text-sm text-muted">{t.summary}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" aria-hidden />
              {t.moduleCount ? `${t.moduleCount} módulo${t.moduleCount > 1 ? "s" : ""}` : "Em preparação"}
            </span>
            {t.estimatedMinutes > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden />
                {formatMinutes(t.estimatedMinutes)}
              </span>
            )}
            <span>{LEVEL_LABEL[t.level]}</span>
          </div>
          {t.availability === "available" ? (
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <StatusBadge status={t.progress.status} />
                <span className="text-xs font-medium text-muted">{t.progress.percent}%</span>
              </div>
              <Progress value={t.progress.percent} size="sm" label={`Progresso em ${t.title}`} />
            </div>
          ) : t.availability === "blocked" ? (
            <p className="pt-1 text-xs text-warning">Requer conclusão de “{t.dependsOn?.title}”.</p>
          ) : (
            <p className="pt-1 text-xs text-muted">Sem acesso · {TRACK_MODE_LABEL[t.mode]}</p>
          )}
        </div>
      </Link>
    </Card>
  );
}

export interface Pillars {
  studied: { done: number; total: number };
  assessed: { done: number; total: number };
  demonstrated: { done: number; total: number };
  applied: { done: number; total: number };
}

const PILLARS: { key: keyof Pillars; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "studied", label: "Conteúdo estudado", hint: "Apostilas e materiais concluídos", icon: BookOpenCheck },
  { key: "assessed", label: "Conhecimento avaliado", hint: "Avaliações aprovadas", icon: Target },
  { key: "demonstrated", label: "Habilidade demonstrada", hint: "Simulações e estudos de caso aprovados", icon: Sparkles },
  { key: "applied", label: "Aplicação prática validada", hint: "Atividades acompanhadas validadas", icon: Wrench },
];

/** Os quatro níveis de evolução que o documento pede para diferenciar claramente. */
export function PillarsView({ pillars, validation, compact }: { pillars: Pillars; validation?: { required: boolean; status: string } | null; compact?: boolean }) {
  return (
    <div className={cx("grid gap-3", compact ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4")}>
      {PILLARS.map(({ key, label, hint, icon: Icon }) => {
        const p = pillars[key];
        const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
        const done = p.total > 0 && p.done >= p.total;
        return (
          <div key={key} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className={cx("grid h-7 w-7 place-items-center rounded-lg", done ? "bg-success/15 text-success" : "bg-subtle text-muted")}>
                {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
              </span>
              <p className="text-sm font-medium leading-tight">{label}</p>
            </div>
            <p className="mt-2 text-xs text-muted">{p.total ? `${p.done} de ${p.total}` : "Não se aplica"}</p>
            {p.total > 0 && <Progress value={pct} size="sm" className="mt-1.5" label={label} />}
            {!compact && <p className="mt-1.5 text-[11px] text-muted">{hint}</p>}
          </div>
        );
      })}
      {validation?.required && (
        <div className="col-span-full flex items-center gap-2 rounded-xl border border-border bg-subtle/60 px-3 py-2 text-sm">
          <ShieldCheck className={cx("h-4 w-4", validation.status === "approved" ? "text-success" : validation.status === "rejected" ? "text-danger" : "text-muted")} aria-hidden />
          <span>
            Validação do líder:{" "}
            <strong>{validation.status === "approved" ? "aprovada" : validation.status === "rejected" ? "necessita revisão" : "pendente"}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
