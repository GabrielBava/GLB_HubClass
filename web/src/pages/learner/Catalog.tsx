import { Link, useSearchParams } from "react-router";
import { ArrowRight, Filter, Search, X } from "lucide-react";
import { AreaIcon } from "../../components/AreaIcon";
import { TrackCard, type TrackCardData } from "../../components/learning";
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, PageLoader, Progress, Select, Skeleton } from "../../components/ui";
import { LEARNER_TRACK_STATUS, LEARNER_TRACK_STATUS_LABEL, LEVELS, LEVEL_LABEL } from "../../../../shared/domain";
import { useApi, useDebounced, useDocumentTitle } from "../../lib/hooks";
import { useEffect, useState } from "react";

interface AreaItem {
  id: string;
  slug: string;
  code: string | null;
  name: string;
  description: string;
  icon: string;
  color: string;
  trackCount: number;
  availableCount: number;
  completedCount: number;
  inProgressCount: number;
}

export function AreasPage() {
  const { data, isLoading, error, refetch } = useApi<AreaItem[]>("/api/catalog/areas");
  useDocumentTitle("Áreas de conhecimento");
  return (
    <div>
      <PageHeader title="Áreas de conhecimento" description="O catálogo é organizado por áreas. Cada área reúne trilhas de formação, módulos e materiais." />
      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState error={error} retry={refetch} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((a) => {
            const pct = a.availableCount ? Math.round((a.completedCount / a.availableCount) * 100) : 0;
            return (
              <Card key={a.id} as="article" className="group overflow-hidden transition hover:shadow-lg">
                <Link to={a.slug.includes("biblioteca") && a.trackCount === 0 ? "/biblioteca" : `/trilhas?area=${a.slug}`} className="flex h-full flex-col p-5">
                  <div className="flex items-start gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: a.color }}>
                      <AreaIcon name={a.icon} className="h-6 w-6" />
                    </span>
                    <div className="min-w-0">
                      {a.code && <p className="text-xs font-semibold text-muted">Área {a.code}</p>}
                      <h2 className="font-heading text-lg font-semibold leading-snug group-hover:text-primary">{a.name}</h2>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm text-muted">{a.description}</p>
                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>
                        {a.trackCount} trilha{a.trackCount === 1 ? "" : "s"} · {a.availableCount} liberada{a.availableCount === 1 ? "" : "s"}
                      </span>
                      <span>{a.completedCount} concluída{a.completedCount === 1 ? "" : "s"}</span>
                    </div>
                    <Progress value={pct} size="sm" className="mt-2" label={`Conclusão na área ${a.name}`} />
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
                      {a.trackCount === 0 ? "Abrir biblioteca" : "Ver trilhas"} <ArrowRight className="h-4 w-4" aria-hidden />
                    </span>
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface CatalogData {
  tracks: (TrackCardData & { specialty: string; jobTitleIds: string[]; area: TrackCardData["area"] & { id: string; slug: string } })[];
  filters: { areas: { id: string; name: string; slug: string }[]; specialties: string[]; jobTitles: { id: string; name: string }[] };
  allowAccessRequests: boolean;
}

const FILTER_KEYS = ["area", "level", "status", "jobTitle", "specialty", "required", "mode"] as const;

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const debounced = useDebounced(q);
  useDocumentTitle("Catálogo de trilhas");
  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced) next.set("q", debounced);
    else next.delete("q");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = new URLSearchParams();
  for (const k of [...FILTER_KEYS, "q"]) {
    const v = params.get(k);
    if (v) query.set(k, v);
  }
  if (params.get("obrigatoria")) query.set("required", "mandatory");
  const { data, isLoading, error, refetch } = useApi<CatalogData>(`/api/catalog/tracks?${query.toString()}`);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("obrigatoria");
    setParams(next, { replace: true });
  };
  const active = FILTER_KEYS.some((k) => params.get(k)) || !!params.get("q") || !!params.get("obrigatoria");

  return (
    <div>
      <PageHeader title="Catálogo de trilhas" description="Encontre trilhas por área, especialidade, cargo, nível e status." />
      <Card className="mb-6 p-4">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label="Buscar trilhas" placeholder="Buscar por título, área ou tema" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Select aria-label="Área" value={params.get("area") ?? ""} onChange={(e) => set("area", e.target.value)} placeholder="Todas as áreas" options={(data?.filters.areas ?? []).map((a) => ({ value: a.slug, label: a.name }))} />
            <Select aria-label="Especialidade" value={params.get("specialty") ?? ""} onChange={(e) => set("specialty", e.target.value)} placeholder="Especialidade" options={(data?.filters.specialties ?? []).map((s) => ({ value: s, label: s }))} />
            <Select aria-label="Cargo" value={params.get("jobTitle") ?? ""} onChange={(e) => set("jobTitle", e.target.value)} placeholder="Cargo" options={(data?.filters.jobTitles ?? []).map((j) => ({ value: j.id, label: j.name }))} />
            <Select aria-label="Nível" value={params.get("level") ?? ""} onChange={(e) => set("level", e.target.value)} placeholder="Nível" options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} />
            <Select aria-label="Status" value={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)} placeholder="Status" options={LEARNER_TRACK_STATUS.map((s) => ({ value: s, label: LEARNER_TRACK_STATUS_LABEL[s] }))} />
            <Select
              aria-label="Obrigatoriedade"
              value={params.get("required") ?? (params.get("obrigatoria") ? "mandatory" : "")}
              onChange={(e) => set("required", e.target.value)}
              placeholder="Obrigatória ou opcional"
              options={[
                { value: "mandatory", label: "Obrigatórias" },
                { value: "optional", label: "Opcionais" },
              ]}
            />
          </div>
          {active && (
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <Filter className="h-4 w-4" aria-hidden /> {data?.tracks.length ?? 0} trilha(s) encontrada(s)
              </p>
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                onClick={() => {
                  setQ("");
                  setParams(new URLSearchParams(), { replace: true });
                }}
              >
                Limpar filtros
              </Button>
            </div>
          )}
        </div>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : error || !data ? (
        <ErrorState error={error} retry={refetch} />
      ) : data.tracks.length === 0 ? (
        <EmptyState title="Nenhuma trilha encontrada" description="Ajuste os filtros ou limpe a busca." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.tracks.map((t) => (
            <TrackCard key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
