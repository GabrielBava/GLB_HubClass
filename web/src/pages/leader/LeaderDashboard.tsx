import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { AlertTriangle, ArrowLeft, Award, CalendarX, ClipboardCheck, Download, Info, KeyRound, MessageSquarePlus, Plus, Search, ShieldCheck, Target, Trash2, Users } from "lucide-react";
import { FEEDBACK_KINDS, FEEDBACK_KIND_LABEL, LEARNER_TRACK_STATUS_LABEL, PRACTICE_STAGE_LABEL, SUBMISSION_STATUS_LABEL, type FeedbackKind, type LearnerTrackStatus, type PracticeStage, type SubmissionStatus } from "../../../../shared/domain";
import { MonthlyEvolution } from "../../components/charts";
import { PillarsView, StatusBadge, type Pillars } from "../../components/learning";
import { Alert, Avatar, Badge, Button, Card, CardHeader, Checkbox, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Progress, Select, StatCard, Switch, TableWrap, Tabs, Textarea, td, th } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatDate, relativeTime } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { NotFoundPage } from "../Errors";

interface Member {
  id: string;
  name: string;
  email: string;
  code: string;
  jobTitle: string | null;
  team: string | null;
  lastActivityDate: string | null;
  tracks: number;
  assigned: number;
  completed: number;
  inProgress: number;
  mandatoryPending: number;
  overdue: number;
  completionPercent: number;
  avgScore: number | null;
  pendingPractical: number;
  competenciesValidated: number;
  struggling: boolean;
  strugglingReasons: string[];
}
interface Overview {
  kpis: { members: number; avgCompletion: number; mandatoryPending: number; overdue: number; pendingValidations: number; struggling: number; competenciesValidated: number };
  members: Member[];
  evolution: { month: string; started: number; completed: number }[];
  assignableTracks: { id: string; title: string; areaId: string; areaName: string }[];
  scope: { role: string; areaIds: string[]; teamIds: string[] };
}

export function AssignModal({ open, onClose, members, tracks, preselected }: { open: boolean; onClose: () => void; members: { id: string; name: string }[]; tracks: Overview["assignableTracks"]; preselected?: string[] }) {
  const [selected, setSelected] = useState<string[]>(preselected ?? []);
  const [trackId, setTrackId] = useState("");
  const [due, setDue] = useState("");
  const [mandatory, setMandatory] = useState(true);
  const assign = useAction(() => api.post("/api/leader/assignments", { userIds: selected, trackId, dueDate: due || null, isMandatory: mandatory }), {
    invalidate: ["/api/leader"],
    success: (r) => `Trilha atribuída a ${(r as { assigned: number }).assigned} colaborador(es).`,
    onSuccess: onClose,
  });
  const byArea = useMemo(() => tracks.map((t) => ({ value: t.id, label: `${t.areaName} — ${t.title}` })), [tracks]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Atribuir treinamento"
      description="O colaborador recebe acesso à trilha, uma notificação e o prazo definido."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button loading={assign.isPending} disabled={!trackId || !selected.length} onClick={() => assign.mutate(undefined)}>Atribuir</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Trilha" htmlFor="assign-track">
          <Select id="assign-track" value={trackId} onChange={(e) => setTrackId(e.target.value)} placeholder="Selecione a trilha" options={byArea} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prazo (opcional)" htmlFor="assign-due">
            <Input id="assign-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <div className="pt-7">
            <Switch checked={mandatory} onChange={setMandatory} label="Treinamento obrigatório" />
          </div>
        </div>
        {!preselected && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Colaboradores</legend>
            <div className="mb-2 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(members.map((m) => m.id))}>Selecionar todos</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Limpar</Button>
            </div>
            <div className="grid max-h-60 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
              {members.map((m) => (
                <Checkbox key={m.id} label={m.name} checked={selected.includes(m.id)} onChange={(v) => setSelected((s) => (v ? [...s, m.id] : s.filter((x) => x !== m.id)))} />
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

export function LeaderDashboardPage() {
  const { data, isLoading, error, refetch } = useApi<Overview>("/api/leader/overview");
  const [q, setQ] = useState("");
  const [onlyStruggling, setOnlyStruggling] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  useDocumentTitle("Painel do líder");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const members = data.members.filter((m) => (!onlyStruggling || m.struggling) && `${m.name} ${m.email} ${m.jobTitle ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const k = data.kpis;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel do líder"
        description="Acompanhe a capacitação da sua equipe, atribua treinamentos e valide competências."
        actions={
          <>
            <a href="/api/leader/report.csv">
              <Button variant="outline" icon={Download}>Exportar relatório</Button>
            </a>
            <Button icon={Plus} onClick={() => setAssignOpen(true)} disabled={!data.members.length || !data.assignableTracks.length}>Atribuir treinamento</Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Colaboradores" value={k.members} icon={Users} />
        <StatCard label="Conclusão média" value={`${k.avgCompletion}%`} icon={Target} />
        <StatCard label="Obrigatórias pendentes" value={k.mandatoryPending} icon={ClipboardCheck} tone="warning" />
        <StatCard label="Prazos vencidos" value={k.overdue} icon={CalendarX} tone="danger" />
        <StatCard label="Validações pendentes" value={k.pendingValidations} icon={ShieldCheck} tone="info" />
        <StatCard label="Com dificuldade" value={k.struggling} icon={AlertTriangle} tone="warning" />
        <StatCard label="Competências validadas" value={k.competenciesValidated} icon={Award} tone="success" />
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Colaboradores" description="Clique para ver detalhes, registrar feedback e validar atividades." />
          <div className="flex flex-col gap-3 p-5 pb-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input aria-label="Buscar colaborador" placeholder="Buscar colaborador" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
            </div>
            <Switch checked={onlyStruggling} onChange={setOnlyStruggling} label="Só com dificuldade" />
          </div>
          {members.length === 0 ? (
            <div className="p-5"><EmptyState icon={Users} title="Nenhum colaborador encontrado" description={data.members.length ? "Ajuste a busca." : "Você ainda não lidera nenhuma equipe. Peça ao administrador para configurar seu escopo."} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr>
                    <th className={th}>Colaborador</th>
                    <th className={th}>Progresso</th>
                    <th className={th}>Obrig.</th>
                    <th className={th}>Atrasos</th>
                    <th className={th}>Média</th>
                    <th className={th}>Práticas</th>
                    <th className={th}>Atividade</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-subtle/50">
                      <td className={td}>
                        <Link to={`/lider/equipe/${m.id}`} className="flex items-center gap-3">
                          <Avatar name={m.name} size={32} />
                          <span>
                            <span className="block font-medium hover:text-primary">{m.name}</span>
                            <span className="block text-xs text-muted">{m.jobTitle ?? "—"}{m.team ? ` · ${m.team}` : ""}</span>
                          </span>
                          {m.struggling && <span title={m.strugglingReasons.join("; ")}><AlertTriangle className="h-4 w-4 text-warning" aria-label={`Atenção: ${m.strugglingReasons.join("; ")}`} /></span>}
                        </Link>
                      </td>
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <Progress value={m.completionPercent} size="sm" className="w-20" label={`Progresso de ${m.name}`} />
                          <span className="text-xs">{m.completionPercent}%</span>
                        </div>
                        <span className="text-xs text-muted">{m.completed}/{m.tracks} trilhas</span>
                      </td>
                      <td className={td}>{m.mandatoryPending || "—"}</td>
                      <td className={td}>{m.overdue ? <Badge tone="danger">{m.overdue}</Badge> : "—"}</td>
                      <td className={td}>{m.avgScore === null ? "—" : `${m.avgScore}%`}</td>
                      <td className={td}>{m.pendingPractical ? <Badge tone="info">{m.pendingPractical} pendente(s)</Badge> : "—"}</td>
                      <td className={td}>{formatDate(m.lastActivityDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Evolução da equipe" description="Trilhas iniciadas e concluídas por mês" />
            <div className="p-5 pt-3">
              <MonthlyEvolution data={data.evolution} />
            </div>
          </Card>
          <Alert tone="info" icon={Info} title="Transparência">
            O painel mostra apenas indicadores de gestão educacional: progresso, notas, entregas e a data da última atividade. Horários de uso, tempo de tela e anotações pessoais não são exibidos.
          </Alert>
        </div>
      </div>
      {assignOpen && <AssignModal open onClose={() => setAssignOpen(false)} members={data.members} tracks={data.assignableTracks} />}
    </div>
  );
}

interface MemberDetail {
  member: { id: string; name: string; email: string; code: string; jobTitle: string | null; team: string | null; lastActivityDate: string | null };
  tracks: { enrollmentId: string; trackId: string; title: string; areaName: string; inScope: boolean; status: LearnerTrackStatus; percent: number; source: string; isMandatory: boolean; dueDate: string | null; startedAt: string | null; completedAt: string | null; lastActivityDate: string | null; requiresLeaderValidation: boolean; pillars: Pillars | null; validation: { required: boolean; status: string } | null }[];
  attempts: { id: string; title: string; trackTitle: string; number: number; status: string; score: number | null; passed: boolean | null; submittedAt: string | null }[];
  submissions: { id: string; title: string; stage: PracticeStage; competency: string; trackTitle: string; status: SubmissionStatus; submittedAt: string; reviewerComment: string | null }[];
  feedback: { id: string; kind: FeedbackKind; body: string; author: string | null; createdAt: string }[];
  access: { id: string; resourceType: string; resourceId: string; effect: "allow" | "deny"; note: string; createdAt: string; title: string }[];
}

export function MemberPage() {
  const { id = "" } = useParams();
  const url = `/api/leader/members/${id}`;
  const { data, isLoading, error, refetch } = useApi<MemberDetail>(url);
  const overview = useApi<Overview>("/api/leader/overview");
  const [tab, setTab] = useState<"tracks" | "assessments" | "practice" | "feedback" | "access">("tracks");
  const [assign, setAssign] = useState(false);
  const [fb, setFb] = useState({ kind: "feedback" as FeedbackKind, body: "", trackId: "" });
  const [grant, setGrant] = useState<{ open: boolean; trackId: string; effect: "allow" | "deny"; note: string }>({ open: false, trackId: "", effect: "allow", note: "" });
  const [validate, setValidate] = useState<{ trackId: string; title: string; decision: "approved" | "rejected"; comment: string } | null>(null);
  useDocumentTitle(data?.member.name);
  const sendFb = useAction(() => api.post("/api/leader/feedback", { userId: id, kind: fb.kind, body: fb.body, trackId: fb.trackId || null, reference: fb.kind === "recommendation" && fb.trackId ? { type: "track", id: fb.trackId } : null }), {
    invalidate: [url],
    success: "Feedback registrado e enviado ao colaborador.",
    onSuccess: () => setFb({ kind: "feedback", body: "", trackId: "" }),
  });
  const removeAssignment = useAction((trackId: string) => api.del("/api/leader/assignments", { userId: id, trackId }), { invalidate: [url, "/api/leader"], success: "Atribuição removida." });
  const createRule = useAction(() => api.post("/api/leader/access", { userId: id, resourceType: "track", resourceId: grant.trackId, effect: grant.effect, note: grant.note }), {
    invalidate: [url],
    success: "Acesso atualizado.",
    onSuccess: () => setGrant({ open: false, trackId: "", effect: "allow", note: "" }),
  });
  const deleteRule = useAction((ruleId: string) => api.del(`/api/leader/access/${ruleId}`), { invalidate: [url], success: "Regra removida." });
  const sendValidation = useAction(() => api.post("/api/leader/validations", { userId: id, trackId: validate!.trackId, decision: validate!.decision, comment: validate!.comment }), {
    invalidate: [url, "/api/leader"],
    success: "Validação registrada.",
    onSuccess: () => setValidate(null),
  });

  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const m = data.member;
  const tracks = overview.data?.assignableTracks ?? [];
  return (
    <div className="space-y-6">
      <Link to="/lider" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Painel do líder
      </Link>
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <Avatar name={m.name} size={56} />
        <div className="flex-1">
          <h1 className="font-heading text-2xl font-bold">{m.name}</h1>
          <p className="text-sm text-muted">{m.jobTitle ?? "—"}{m.team ? ` · ${m.team}` : ""} · {m.code} · última atividade {formatDate(m.lastActivityDate)}</p>
        </div>
        <Button icon={Plus} onClick={() => setAssign(true)} disabled={!tracks.length}>Atribuir trilha</Button>
      </Card>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "tracks", label: "Trilhas", count: data.tracks.length },
          { id: "assessments", label: "Avaliações", count: data.attempts.length },
          { id: "practice", label: "Atividades práticas", count: data.submissions.length },
          { id: "feedback", label: "Feedback", count: data.feedback.length },
          { id: "access", label: "Acessos", count: data.access.length },
        ]}
      />
      {tab === "tracks" && (
        <div className="space-y-3">
          {data.tracks.length === 0 && <EmptyState title="Nenhuma trilha iniciada ou atribuída" />}
          {data.tracks.map((t) => (
            <Card key={t.enrollmentId} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted">{t.areaName}</p>
                  <p className="font-heading font-semibold">{t.title}</p>
                  <p className="text-xs text-muted">
                    {t.source === "self" ? "Iniciada pelo colaborador" : "Atribuída"}
                    {t.dueDate ? ` · prazo ${formatDate(t.dueDate)}` : ""}
                    {t.completedAt ? ` · concluída em ${formatDate(t.completedAt)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {t.isMandatory && <Badge tone="warning">Obrigatória</Badge>}
                  <StatusBadge status={t.status} />
                  <span className="text-sm font-medium">{t.percent}%</span>
                </div>
              </div>
              {t.pillars && <div className="mt-3"><PillarsView pillars={t.pillars} validation={t.validation} compact /></div>}
              {t.inScope && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {t.requiresLeaderValidation && t.status === "pending_validation" && (
                    <Button size="sm" icon={ShieldCheck} onClick={() => setValidate({ trackId: t.trackId, title: t.title, decision: "approved", comment: "" })}>Validar competência</Button>
                  )}
                  {t.source !== "self" && (
                    <ConfirmButton title="Remover atribuição?" message="O progresso é mantido, mas a trilha deixa de ser obrigatória e o acesso concedido pela atribuição é retirado." onConfirm={() => removeAssignment.mutateAsync(t.trackId)} icon={Trash2}>
                      Remover atribuição
                    </ConfirmButton>
                  )}
                </div>
              )}
              {!t.inScope && <p className="mt-2 text-xs text-muted">Trilha de outra área: apenas o resumo é exibido.</p>}
            </Card>
          ))}
        </div>
      )}
      {tab === "assessments" && (
        data.attempts.length === 0 ? <EmptyState title="Nenhuma avaliação nas suas áreas" /> : (
          <TableWrap>
            <thead><tr><th className={th}>Avaliação</th><th className={th}>Tentativa</th><th className={th}>Resultado</th><th className={th}></th></tr></thead>
            <tbody>
              {data.attempts.map((a) => (
                <tr key={a.id}>
                  <td className={td}><span className="font-medium">{a.title}</span><p className="text-xs text-muted">{a.trackTitle}</p></td>
                  <td className={td}>{a.number}ª · {formatDate(a.submittedAt)}</td>
                  <td className={td}>{a.status === "graded" ? <Badge tone={a.passed ? "success" : "danger"}>{a.score}%</Badge> : <Badge tone="info">{a.status === "pending_review" ? "Aguardando correção" : "Em andamento"}</Badge>}</td>
                  <td className={td}>{a.status === "pending_review" && <Link to={`/lider/validacoes/tentativas/${a.id}`} className="text-sm text-primary hover:underline">Corrigir</Link>}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )
      )}
      {tab === "practice" && (
        data.submissions.length === 0 ? <EmptyState title="Nenhuma atividade prática enviada" /> : (
          <div className="space-y-2">
            {data.submissions.map((s) => (
              <Card key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-muted">{PRACTICE_STAGE_LABEL[s.stage]} · {s.trackTitle} · {formatDate(s.submittedAt)}</p>
                  {s.reviewerComment && <p className="mt-1 text-sm text-muted">“{s.reviewerComment}”</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={s.status === "approved" ? "success" : s.status === "submitted" ? "info" : "warning"}>{SUBMISSION_STATUS_LABEL[s.status]}</Badge>
                  {s.status === "submitted" && <Link to="/lider/validacoes" className="text-sm text-primary hover:underline">Avaliar</Link>}
                </div>
              </Card>
            ))}
          </div>
        )
      )}
      {tab === "feedback" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-3 p-5">
            <h2 className="font-heading font-semibold">Registrar feedback</h2>
            <Field label="Tipo" htmlFor="fb-kind">
              <Select id="fb-kind" value={fb.kind} onChange={(e) => setFb({ ...fb, kind: e.target.value as FeedbackKind })} options={FEEDBACK_KINDS.map((k) => ({ value: k, label: FEEDBACK_KIND_LABEL[k] }))} />
            </Field>
            <Field label={fb.kind === "recommendation" ? "Trilha recomendada" : "Trilha relacionada (opcional)"} htmlFor="fb-track">
              <Select id="fb-track" value={fb.trackId} onChange={(e) => setFb({ ...fb, trackId: e.target.value })} placeholder="—" options={tracks.map((t) => ({ value: t.id, label: t.title }))} />
            </Field>
            <Field label="Mensagem" htmlFor="fb-body">
              <Textarea id="fb-body" value={fb.body} onChange={(e) => setFb({ ...fb, body: e.target.value })} placeholder="Seja específico: o que foi bem, o que melhorar e o próximo passo." />
            </Field>
            <Button icon={MessageSquarePlus} loading={sendFb.isPending} disabled={!fb.body.trim()} onClick={() => sendFb.mutate(undefined)}>Enviar feedback</Button>
          </Card>
          <div className="space-y-2">
            {data.feedback.length === 0 && <p className="text-sm text-muted">Nenhum feedback registrado.</p>}
            {data.feedback.map((f) => (
              <Card key={f.id} className="p-4 text-sm">
                <div className="mb-1 flex items-center gap-2"><Badge tone="primary">{FEEDBACK_KIND_LABEL[f.kind]}</Badge><span className="text-xs text-muted">{f.author} · {relativeTime(f.createdAt)}</span></div>
                <p className="whitespace-pre-line">{f.body}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
      {tab === "access" && (
        <div className="space-y-3">
          <div className="flex justify-between gap-3">
            <p className="text-sm text-muted">Libere ou bloqueie trilhas das suas áreas para este colaborador. Você não pode conceder acesso fora do seu escopo.</p>
            <Button size="sm" icon={KeyRound} onClick={() => setGrant({ ...grant, open: true })}>Alterar acesso</Button>
          </div>
          {data.access.length === 0 ? <EmptyState icon={KeyRound} title="Nenhuma regra individual" description="O acesso vem das regras do cargo, área ou equipe definidas pelo administrador." /> : (
            <Card className="divide-y divide-border">
              {data.access.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div>
                    <Badge tone={r.effect === "allow" ? "success" : "danger"}>{r.effect === "allow" ? "Permitido" : "Bloqueado"}</Badge> <span className="font-medium">{r.title}</span>
                    {r.note && <p className="text-xs text-muted">{r.note}</p>}
                  </div>
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => deleteRule.mutate(r.id)}>Remover</Button>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}
      {assign && <AssignModal open onClose={() => setAssign(false)} members={[{ id, name: m.name }]} preselected={[id]} tracks={tracks} />}
      <Modal open={grant.open} onClose={() => setGrant({ ...grant, open: false })} title="Alterar acesso do colaborador" footer={<><Button variant="ghost" onClick={() => setGrant({ ...grant, open: false })}>Cancelar</Button><Button loading={createRule.isPending} disabled={!grant.trackId} onClick={() => createRule.mutate(undefined)}>Salvar</Button></>}>
        <div className="space-y-4">
          <Field label="Trilha" htmlFor="g-track"><Select id="g-track" value={grant.trackId} onChange={(e) => setGrant({ ...grant, trackId: e.target.value })} placeholder="Selecione" options={tracks.map((t) => ({ value: t.id, label: `${t.areaName} — ${t.title}` }))} /></Field>
          <Field label="Efeito" htmlFor="g-eff"><Select id="g-eff" value={grant.effect} onChange={(e) => setGrant({ ...grant, effect: e.target.value as "allow" | "deny" })} options={[{ value: "allow", label: "Liberar acesso" }, { value: "deny", label: "Bloquear acesso (prevalece sobre permissões)" }]} /></Field>
          <Field label="Motivo (registrado na auditoria)" htmlFor="g-note"><Input id="g-note" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={!!validate} onClose={() => setValidate(null)} title={`Validar competência — ${validate?.title ?? ""}`} footer={<><Button variant="ghost" onClick={() => setValidate(null)}>Cancelar</Button><Button loading={sendValidation.isPending} onClick={() => sendValidation.mutate(undefined)}>Registrar validação</Button></>}>
        {validate && (
          <div className="space-y-4">
            <Select aria-label="Decisão" value={validate.decision} onChange={(e) => setValidate({ ...validate, decision: e.target.value as "approved" | "rejected" })} options={[{ value: "approved", label: "Aprovar: competência validada" }, { value: "rejected", label: "Necessita revisão" }]} />
            <Field label="Comentário" htmlFor="v-comment" hint={validate.decision === "rejected" ? "Obrigatório: explique o que precisa ser revisto." : undefined}>
              <Textarea id="v-comment" value={validate.comment} onChange={(e) => setValidate({ ...validate, comment: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
      <p className="text-xs text-muted">Status possíveis: {Object.values(LEARNER_TRACK_STATUS_LABEL).join(" · ")}.</p>
    </div>
  );
}
