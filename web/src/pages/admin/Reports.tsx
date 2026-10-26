import { useState } from "react";
import { Activity, Award, BookOpenCheck, Download, Hammer, Hourglass, Info, Target, TrendingDown, UserCheck, Users as UsersIcon } from "lucide-react";
import { MonthlyEvolution } from "../../components/charts";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, PageHeader, PageLoader, Select, StatCard, TableWrap, td, th } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useApi, useDebounced, useDocumentTitle } from "../../lib/hooks";

interface GroupRow {
  name: string;
  enrollments: number;
  completed: number;
  avgPercent: number;
}
interface Overview {
  period: { from: string; to: string };
  engagement: { activeUsers: number; engagedLast30Days: number; tracksStarted: number; tracksCompleted: number; abandonmentRate: number | null; evolution: { month: string; started: number; completed: number }[] };
  learning: {
    averageScore: number | null;
    passRate: number | null;
    attemptsPerAssessment: number | null;
    hardestAssessments: { id: string; title: string; trackTitle: string; attempts: number; passRate: number }[];
    hardestQuestions: { id: string; prompt: string; answers: number; correctRate: number }[];
    pendingValidations: number;
  };
  development: { competenciesDemonstrated: number; practiceValidated: number; avgDaysToComplete: number | null; avgDaysToFirstSupervisedExecution: number | null; byJobTitle: GroupRow[]; byArea: GroupRow[] };
  commercial: { available: boolean; note: string };
}

const num = (v: number | null, suffix = "") => (v === null ? "—" : `${v.toLocaleString("pt-BR")}${suffix}`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Barras horizontais de uma única série (progresso médio %) com rótulo direto e tabela equivalente. */
function GroupBars({ rows, label }: { rows: GroupRow[]; label: string }) {
  const [table, setTable] = useState(false);
  if (!rows.length) return <p className="text-sm text-muted">Sem matrículas no período.</p>;
  return (
    <div>
      {table ? (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>{label}</th>
              <th className={th}>Matrículas</th>
              <th className={th}>Concluídas</th>
              <th className={th}>Progresso médio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td className={td}>{r.name}</td>
                <td className={td}>{r.enrollments}</td>
                <td className={td}>{r.completed}</td>
                <td className={td}>{r.avgPercent}%</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 10).map((r) => (
            <li key={r.name} title={`${r.name}: ${r.avgPercent}% de progresso médio, ${r.completed} de ${r.enrollments} concluídas`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{r.name}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  <span className="font-semibold text-fg">{r.avgPercent}%</span> · {r.completed}/{r.enrollments}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-subtle">
                <div className="h-full rounded-full" style={{ width: `${Math.max(2, r.avgPercent)}%`, background: "var(--chart-1)" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <button className="mt-3 text-xs text-primary hover:underline" onClick={() => setTable((t) => !t)}>
        {table ? "Ver barras" : "Ver como tabela"}
      </button>
    </div>
  );
}

export function ReportsPage() {
  const today = new Date();
  const [filters, setFilters] = useState({ from: isoDay(new Date(today.getTime() - 90 * 86_400_000)), to: isoDay(today), areaId: "" });
  const { data: areas } = useApi<{ id: string; name: string }[]>("/api/admin/content/tree");
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.areaId) params.set("areaId", filters.areaId);
  const { data, isLoading, error, refetch } = useApi<Overview>(`/api/admin/reports/overview?${params.toString()}`);
  useDocumentTitle("Indicadores");

  return (
    <div>
      <PageHeader
        title="Indicadores"
        description="Engajamento, aprendizagem e desenvolvimento. Os números orientam decisões de capacitação; não são instrumento de vigilância individual."
        actions={
          <div className="flex flex-wrap gap-2">
            {(["enrollments", "attempts", "users"] as const).map((t) => (
              <a key={t} href={`/api/admin/reports/export.csv?type=${t}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium hover:bg-subtle">
                <Download className="h-4 w-4" /> {t === "enrollments" ? "Matrículas" : t === "attempts" ? "Avaliações" : "Usuários"} (CSV)
              </a>
            ))}
          </div>
        }
      />
      <Card className="mb-5 grid gap-3 p-4 sm:grid-cols-3">
        <Field label="De" htmlFor="r-from">
          <Input id="r-from" type="date" value={filters.from} max={filters.to} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </Field>
        <Field label="Até" htmlFor="r-to">
          <Input id="r-to" type="date" value={filters.to} min={filters.from} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </Field>
        <Field label="Área" htmlFor="r-area">
          <Select id="r-area" value={filters.areaId} placeholder="Todas as áreas" onChange={(e) => setFilters({ ...filters, areaId: e.target.value })} options={(areas ?? []).map((a) => ({ value: a.id, label: a.name }))} />
        </Field>
      </Card>

      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState error={error} retry={refetch} />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="eng">
            <h2 id="eng" className="mb-3 font-heading text-lg font-semibold">
              Engajamento
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Usuários ativos" value={data.engagement.activeUsers} icon={UsersIcon} />
              <StatCard label="Acessaram nos últimos 30 dias" value={data.engagement.engagedLast30Days} icon={Activity} hint={data.engagement.activeUsers ? `${Math.round((data.engagement.engagedLast30Days / data.engagement.activeUsers) * 100)}% dos ativos` : undefined} />
              <StatCard label="Trilhas iniciadas" value={data.engagement.tracksStarted} icon={BookOpenCheck} hint="no período" />
              <StatCard label="Trilhas concluídas" value={data.engagement.tracksCompleted} icon={Award} tone="success" hint="no período" />
              <StatCard label="Abandono" value={num(data.engagement.abandonmentRate, "%")} icon={TrendingDown} tone="warning" hint="iniciadas sem atividade há 30 dias" />
            </div>
            <Card className="mt-4 p-5">
              <CardHeader flush title="Evolução mensal" description="Trilhas iniciadas e concluídas nos últimos 12 meses." />
              <div className="mt-4">
                <MonthlyEvolution data={data.engagement.evolution} />
              </div>
            </Card>
          </section>

          <section aria-labelledby="learn">
            <h2 id="learn" className="mb-3 font-heading text-lg font-semibold">
              Aprendizagem
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Nota média" value={num(data.learning.averageScore, "%")} icon={Target} />
              <StatCard label="Aprovação" value={num(data.learning.passRate, "%")} icon={Award} tone="success" />
              <StatCard label="Tentativas por avaliação" value={num(data.learning.attemptsPerAssessment)} icon={Activity} />
              <StatCard label="Validações pendentes" value={data.learning.pendingValidations} icon={Hourglass} tone="warning" hint="atividades e correções manuais" />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <Card className="p-5">
                <CardHeader flush title="Avaliações com menor aprovação" description="Mínimo de 3 tentativas corrigidas." />
                {data.learning.hardestAssessments.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">Dados insuficientes no período.</p>
                ) : (
                  <ul className="mt-4 divide-y divide-border text-sm">
                    {data.learning.hardestAssessments.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{a.title}</span>
                          <span className="text-xs text-muted">
                            {a.trackTitle} · {a.attempts} tentativa(s)
                          </span>
                        </span>
                        <Badge tone={a.passRate < 50 ? "danger" : a.passRate < 75 ? "warning" : "success"}>{a.passRate}% aprovação</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="p-5">
                <CardHeader flush title="Questões com mais erros" description="Indicam pontos do conteúdo que precisam de reforço." />
                {data.learning.hardestQuestions.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">Dados insuficientes no período.</p>
                ) : (
                  <ul className="mt-4 divide-y divide-border text-sm">
                    {data.learning.hardestQuestions.map((q) => (
                      <li key={q.id} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="line-clamp-2 min-w-0">{q.prompt}</span>
                        <Badge tone={q.correctRate < 50 ? "danger" : "warning"}>{q.correctRate}% acerto</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </section>

          <section aria-labelledby="dev">
            <h2 id="dev" className="mb-3 font-heading text-lg font-semibold">
              Desenvolvimento
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Competências demonstradas" value={data.development.competenciesDemonstrated} icon={Hammer} />
              <StatCard label="Aplicações validadas" value={data.development.practiceValidated} icon={UserCheck} tone="success" />
              <StatCard label="Dias até concluir uma trilha" value={num(data.development.avgDaysToComplete)} icon={Hourglass} hint="média" />
              <StatCard label="Dias até a 1ª execução supervisionada" value={num(data.development.avgDaysToFirstSupervisedExecution)} icon={Target} hint="média, desde o primeiro estudo" />
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <Card className="p-5">
                <CardHeader flush title="Progresso médio por cargo" />
                <div className="mt-4">
                  <GroupBars rows={data.development.byJobTitle} label="Cargo" />
                </div>
              </Card>
              <Card className="p-5">
                <CardHeader flush title="Progresso médio por área" />
                <div className="mt-4">
                  <GroupBars rows={data.development.byArea} label="Área" />
                </div>
              </Card>
            </div>
          </section>

          <section aria-labelledby="com">
            <h2 id="com" className="mb-3 font-heading text-lg font-semibold">
              Resultados comerciais
            </h2>
            <Alert tone="info" icon={Info} title="Disponível após a integração com o CRM">
              {data.commercial.note}
            </Alert>
          </section>
        </div>
      )}
    </div>
  );
}

interface AuditRow {
  id: number;
  at: string;
  actorEmail: string | null;
  action: string;
  outcome: "success" | "failure" | "denied";
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
}

const OUTCOME_LABEL = { success: "Sucesso", failure: "Falha", denied: "Negado" } as const;
const ACTION_GROUPS = [
  { value: "auth.", label: "Autenticação e sessões" },
  { value: "authz.", label: "Acessos negados" },
  { value: "user.", label: "Usuários" },
  { value: "access.", label: "Regras de permissão" },
  { value: "assignment.", label: "Atribuições" },
  { value: "content.", label: "Conteúdos e leitura" },
  { value: "reader.", label: "Leitor protegido" },
  { value: "track.", label: "Trilhas" },
  { value: "assessment.", label: "Avaliações" },
  { value: "settings.", label: "Configurações" },
  { value: "terms.", label: "Termos de uso" },
  { value: "privacy.", label: "Privacidade (LGPD)" },
  { value: "report.", label: "Exportações" },
];

export function AuditPage() {
  const [f, setF] = useState({ action: "", actor: "", outcome: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const actor = useDebounced(f.actor, 350);
  const params = new URLSearchParams({ page: String(page) });
  if (f.action) params.set("action", f.action);
  if (actor.trim()) params.set("actor", actor.trim());
  if (f.outcome) params.set("outcome", f.outcome);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  const { data, isLoading, error, refetch } = useApi<{ items: AuditRow[]; total: number; page: number; pageSize: number }>(`/api/admin/audit?${params.toString()}`);
  useDocumentTitle("Auditoria");
  const update = (patch: Partial<typeof f>) => {
    setF({ ...f, ...patch });
    setPage(1);
  };
  const csvParams = new URLSearchParams(params);
  csvParams.delete("page");
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <PageHeader
        title="Auditoria"
        description="Registro somente de inclusão: acessos, alterações de permissão, publicações, exportações e leituras de documentos. Os registros não podem ser editados nem apagados pela aplicação."
        actions={
          <a href={`/api/admin/audit.csv?${csvParams.toString()}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium hover:bg-subtle">
            <Download className="h-4 w-4" /> Exportar CSV
          </a>
        }
      />
      <Card className="mb-4 grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
        <Field label="Tipo de evento" htmlFor="au-action">
          <Select id="au-action" value={f.action} placeholder="Todos" onChange={(e) => update({ action: e.target.value })} options={ACTION_GROUPS} />
        </Field>
        <Field label="E-mail do usuário" htmlFor="au-actor">
          <Input id="au-actor" value={f.actor} onChange={(e) => update({ actor: e.target.value })} />
        </Field>
        <Field label="Resultado" htmlFor="au-out">
          <Select id="au-out" value={f.outcome} placeholder="Todos" onChange={(e) => update({ outcome: e.target.value })} options={Object.entries(OUTCOME_LABEL).map(([value, label]) => ({ value, label }))} />
        </Field>
        <Field label="De" htmlFor="au-from">
          <Input id="au-from" type="date" value={f.from} onChange={(e) => update({ from: e.target.value })} />
        </Field>
        <Field label="Até" htmlFor="au-to">
          <Input id="au-to" type="date" value={f.to} onChange={(e) => update({ to: e.target.value })} />
        </Field>
      </Card>
      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState error={error} retry={refetch} />
      ) : data.items.length === 0 ? (
        <EmptyState title="Nenhum registro encontrado" />
      ) : (
        <>
          <TableWrap>
            <thead>
              <tr>
                <th className={th}>Data</th>
                <th className={th}>Evento</th>
                <th className={th}>Usuário</th>
                <th className={th}>Alvo</th>
                <th className={th}>Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} whitespace-nowrap`}>{formatDateTime(r.at)}</td>
                  <td className={td}>
                    <code className="text-xs">{r.action}</code>
                    <div className="mt-1">
                      <Badge tone={r.outcome === "success" ? "success" : r.outcome === "denied" ? "warning" : "danger"}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</Badge>
                    </div>
                  </td>
                  <td className={td}>
                    <p>{r.actorEmail ?? "—"}</p>
                    <p className="text-xs text-muted">{r.ip ?? ""}</p>
                  </td>
                  <td className={td}>
                    {r.targetType ? (
                      <>
                        <p>{r.targetType}</p>
                        <p className="max-w-[160px] truncate text-xs text-muted" title={r.targetId ?? ""}>
                          {r.targetId}
                        </p>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={td}>
                    {Object.keys(r.metadata).length ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-primary">Ver</summary>
                        <pre className="mt-1 max-h-48 max-w-sm overflow-auto rounded-lg bg-subtle p-2 text-[11px]">{JSON.stringify(r.metadata, null, 2)}</pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="mt-4 flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">
              {data.total.toLocaleString("pt-BR")} registro(s) · página {data.page} de {pages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
