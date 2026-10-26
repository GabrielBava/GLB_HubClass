import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, CalendarClock, Copy, DoorClosed, KeyRound, Lock, LogOut, Mail, Plus, Search, ShieldOff, UserCheck, UserX } from "lucide-react";
import { ROLES, ROLE_LABEL, USER_STATUS, USER_STATUS_LABEL, LEARNER_TRACK_STATUS_LABEL, type LearnerTrackStatus, type Role, type UserStatus } from "../../../../shared/domain";
import { useToast } from "../../components/toast";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmButton, EmptyState, ErrorState, Field, Input, KeyValue, Modal, PageHeader, PageLoader, Select, TableWrap, Textarea, td, th } from "../../components/ui";
import { api, ApiError } from "../../lib/api";
import { formatDate, formatDateTime, relativeTime } from "../../lib/format";
import { useAction, useApi, useDebounced, useDocumentTitle } from "../../lib/hooks";
import { NotFoundPage } from "../Errors";

interface UserRow {
  id: string;
  code: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  jobTitle: string | null;
  team: string | null;
  department: string | null;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  lockedUntil: string | null;
  approvalRequired: boolean;
  offboardAt: string | null;
}
export interface Org {
  departments: { id: string; name: string }[];
  teams: { id: string; name: string; departmentId: string | null; leaders: { id: string; name: string }[]; members: number }[];
  jobTitles: { id: string; name: string; departmentId: string | null }[];
}

const statusTone = (s: UserStatus) => (s === "active" ? "success" : s === "invited" ? "info" : s === "pending_approval" ? "warning" : "neutral") as "success" | "info" | "warning" | "neutral";

function InviteResult({ link, onClose, kind = "invite" }: { link: string | null; onClose: () => void; kind?: "invite" | "reset" }) {
  const toast = useToast();
  return (
    <div className="space-y-3">
      {link ? (
        <>
          <Alert tone="warning" title="SMTP não configurado">
            Envie o link abaixo ao colaborador por um canal corporativo seguro. Ele é pessoal, de uso único e expira automaticamente.
          </Alert>
          <div className="flex gap-2">
            <Input readOnly value={link} aria-label={kind === "reset" ? "Link de redefinição de senha" : "Link de convite"} onFocus={(e) => e.target.select()} />
            <Button icon={Copy} variant="outline" onClick={() => { void navigator.clipboard?.writeText(link); toast.success("Link copiado."); }}>Copiar</Button>
          </div>
        </>
      ) : (
        <Alert tone="success" title={kind === "reset" ? "Link de redefinição enviado por e-mail" : "Convite enviado por e-mail"} />
      )}
      <div className="flex justify-end"><Button onClick={onClose}>Concluir</Button></div>
    </div>
  );
}

export function UsersPage() {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [role, setRole] = useState("");
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "collaborator" as Role, jobTitleId: "", departmentId: "", teamId: "" });
  const [invite, setInvite] = useState<{ link: string | null } | null>(null);
  useDocumentTitle("Usuários");
  const params = new URLSearchParams();
  if (dq) params.set("q", dq);
  if (role) params.set("role", role);
  if (status) params.set("status", status);
  const { data, isLoading, error, refetch } = useApi<UserRow[]>(`/api/admin/users?${params.toString()}`);
  const org = useApi<Org>("/api/admin/org");
  const settings = useApi<{ settings: { onboarding: { approvalRequired: boolean } } }>("/api/admin/settings");
  const [approval, setApproval] = useState<"auto" | "manual">("auto");
  const approvalDefault = settings.data?.settings.onboarding.approvalRequired ? "manual" : "auto";
  useEffect(() => setApproval(approvalDefault), [approvalDefault]);
  const create = useAction(
    () =>
      api.post<{ inviteLink: string | null }>("/api/admin/users", {
        ...form,
        jobTitleId: form.jobTitleId || null,
        departmentId: form.departmentId || null,
        teamId: form.teamId || null,
        approvalRequired: approval === "manual",
      }),
    {
      invalidate: ["/api/admin/users"],
      onSuccess: (r) => {
        setInvite({ link: r.inviteLink });
        setForm({ name: "", email: "", role: "collaborator", jobTitleId: "", departmentId: "", teamId: "" });
      },
    },
  );
  return (
    <div>
      <PageHeader title="Usuários e convites" description="Cadastro por convite: não há cadastro público. Administradores e líderes usam verificação em duas etapas." actions={<Button icon={Plus} onClick={() => { setInvite(null); setOpen(true); }}>Convidar usuário</Button>} />
      <Card className="mb-4 grid gap-2 p-4 sm:grid-cols-[1fr_200px_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar usuário" placeholder="Nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Select aria-label="Perfil" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Todos os perfis" options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Todos os status" options={USER_STATUS.map((s) => ({ value: s, label: USER_STATUS_LABEL[s] }))} />
      </Card>
      {isLoading ? <PageLoader /> : error || !data ? <ErrorState error={error} retry={refetch} /> : !data.length ? <EmptyState title="Nenhum usuário encontrado" /> : (
        <TableWrap>
          <thead>
            <tr><th className={th}>Usuário</th><th className={th}>Perfil</th><th className={th}>Cargo / equipe</th><th className={th}>Status</th><th className={th}>MFA</th><th className={th}>Último login</th></tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="hover:bg-subtle/50">
                <td className={td}>
                  <Link to={`/admin/usuarios/${u.id}`} className="font-medium hover:text-primary">{u.name}</Link>
                  <p className="text-xs text-muted">{u.email} · {u.code}</p>
                </td>
                <td className={td}>{ROLE_LABEL[u.role]}</td>
                <td className={td}>{u.jobTitle ?? "—"}<p className="text-xs text-muted">{u.team ?? ""}</p></td>
                <td className={td}>
                  <Badge tone={statusTone(u.status)}>{USER_STATUS_LABEL[u.status]}</Badge>
                  {u.lockedUntil && <Badge tone="danger" icon={Lock} className="ml-1">Bloqueado</Badge>}
                  {u.offboardAt && u.status !== "inactive" && <Badge tone="warning" icon={CalendarClock} className="ml-1">Desligamento em {formatDate(u.offboardAt)}</Badge>}
                </td>
                <td className={td}>{u.mfaEnabled ? <Badge tone="success">Ativo</Badge> : u.role !== "collaborator" ? <Badge tone="warning">Pendente</Badge> : "—"}</td>
                <td className={td}>{u.lastLoginAt ? relativeTime(u.lastLoginAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={invite ? "Convite criado" : "Convidar usuário"}
        size="lg"
        footer={invite ? undefined : <><Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button icon={Mail} loading={create.isPending} disabled={!form.name || !form.email} onClick={() => create.mutate(undefined)}>Criar e enviar convite</Button></>}
      >
        {invite ? (
          <InviteResult link={invite.link} onClose={() => setOpen(false)} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome completo" htmlFor="u-name" required className="sm:col-span-2"><Input id="u-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="E-mail corporativo" htmlFor="u-email" required><Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Perfil" htmlFor="u-role" hint={form.role !== "collaborator" ? "Exigirá verificação em duas etapas." : undefined}>
              <Select id="u-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            </Field>
            <Field label="Cargo" htmlFor="u-job"><Select id="u-job" value={form.jobTitleId} onChange={(e) => setForm({ ...form, jobTitleId: e.target.value })} placeholder="—" options={(org.data?.jobTitles ?? []).map((j) => ({ value: j.id, label: j.name }))} /></Field>
            <Field label="Departamento" htmlFor="u-dep"><Select id="u-dep" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} placeholder="—" options={(org.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} /></Field>
            <Field label="Equipe" htmlFor="u-team"><Select id="u-team" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })} placeholder="—" options={(org.data?.teams ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
            <Field label="Após ativar o convite" htmlFor="u-approval" className="sm:col-span-2" hint="O padrão é definido em Configurações › Primeiro acesso. Enquanto aguarda, a pessoa faz o primeiro acesso, mas não abre conteúdos.">
              <Select
                id="u-approval"
                value={approval}
                onChange={(e) => setApproval(e.target.value as "auto" | "manual")}
                options={[
                  { value: "auto", label: "Liberar o acesso automaticamente" },
                  { value: "manual", label: "Aguardar a liberação do administrador" },
                ]}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

interface UserDetail {
  user: {
    id: string;
    code: string;
    name: string;
    email: string;
    role: Role;
    status: UserStatus;
    jobTitleId: string | null;
    departmentId: string | null;
    teamId: string | null;
    mfaEnabled: boolean;
    lastLoginAt: string | null;
    lockedUntil: string | null;
    onboardingCompletedAt: string | null;
    createdAt: string;
    deactivatedAt: string | null;
    approvalRequired: boolean;
    approvedAt: string | null;
    offboardAt: string | null;
    offboardReason: string | null;
  };
  leaderAreas: { areaId: string; name: string }[];
  leaderTeams: { teamId: string; name: string }[];
  sessions: { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; mfa: boolean }[];
  enrollments: { id: string; trackId: string; title: string; status: LearnerTrackStatus; percent: number; source: string; dueDate: string | null; isMandatory: boolean }[];
}

export function UserDetailPage() {
  const { id = "" } = useParams();
  const url = `/api/admin/users/${id}`;
  const { data, isLoading, error, refetch } = useApi<UserDetail>(url);
  const org = useApi<Org>("/api/admin/org");
  const areas = useApi<{ id: string; name: string }[]>("/api/areas/simple");
  const access = useApi<{ trackId: string; title: string; areaName: string; access: string; explanation: string }[]>(`/api/admin/access/user/${id}`, { enabled: false });
  const [edit, setEdit] = useState<{ name: string; role: Role; jobTitleId: string; departmentId: string; teamId: string } | null>(null);
  const [scope, setScope] = useState<{ areas: string[]; teams: string[] } | null>(null);
  const [invite, setInvite] = useState<{ link: string | null; kind: "invite" | "reset" } | null>(null);
  const [anon, setAnon] = useState("");
  useDocumentTitle(data?.user.name);
  const save = useAction(() => api.patch(url, { ...edit, jobTitleId: edit!.jobTitleId || null, departmentId: edit!.departmentId || null, teamId: edit!.teamId || null }), { invalidate: [url, "/api/admin/users"], success: "Usuário atualizado.", onSuccess: () => setEdit(null) });
  const saveScope = useAction(
    () =>
      api.put(`${url}/leader-scope`, {
        areas: scope!.areas.map((areaId) => ({ areaId })),
        teamIds: scope!.teams,
      }),
    { invalidate: [url], success: "Escopo do líder atualizado.", onSuccess: () => setScope(null) },
  );
  const act = useAction((path: string) => api.post<{ inviteLink?: string | null; invite?: { inviteLink: string | null } | null }>(`${url}/${path}`, path === "anonymize" ? { confirm: anon } : {}), {
    invalidate: [url, "/api/admin/users"],
    success: "Ação concluída.",
    onSuccess: (r, path) => {
      const link = r?.inviteLink ?? r?.invite?.inviteLink;
      if (link !== undefined) setInvite({ link: link ?? null, kind: path === "password-reset" ? "reset" : "invite" });
    },
  });
  const revokeSession = useAction((sid: string) => api.del(`/api/admin/sessions/${sid}`), { invalidate: [url], success: "Sessão encerrada." });
  const [offboarding, setOffboarding] = useState(false);
  const cancelOffboard = useAction(() => api.del(`${url}/offboard`), { invalidate: [url, "/api/admin/users"], success: "Agendamento cancelado." });

  if (isLoading) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const u = data.user;
  const name = (list: { id: string; name: string }[] | undefined, v: string | null) => list?.find((x) => x.id === v)?.name ?? "—";
  return (
    <div className="space-y-6">
      <Link to="/admin/usuarios" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" aria-hidden /> Usuários</Link>
      <PageHeader
        title={u.name}
        description={`${u.email} · ${u.code}`}
        actions={
          <>
            {u.status === "invited" && <Button variant="outline" icon={Mail} onClick={() => act.mutate("invite")}>Reenviar convite</Button>}
            {u.status === "pending_approval" && (
              <>
                <Button icon={UserCheck} loading={act.isPending && act.variables === "approve"} onClick={() => act.mutate("approve")}>Liberar acesso</Button>
                <ConfirmButton title="Recusar o acesso?" message="A conta é desativada e as sessões são encerradas. Você pode reativar depois, se necessário." confirmLabel="Recusar" onConfirm={() => act.mutateAsync("reject")} icon={UserX} size="md">Recusar</ConfirmButton>
              </>
            )}
            {u.status !== "inactive" ? (
              <>
                <ConfirmButton title="Desativar temporariamente?" message="As sessões são encerradas e o acesso fica bloqueado até a reativação. O histórico e a liderança são mantidos. Para desligamento, use a opção Desligamento." confirmLabel="Desativar" onConfirm={() => act.mutateAsync("deactivate")} icon={UserX} size="md">Desativar</ConfirmButton>
                <Button variant="danger" icon={DoorClosed} onClick={() => setOffboarding(true)}>Desligamento</Button>
              </>
            ) : (
              <Button variant="outline" icon={UserCheck} onClick={() => act.mutate("reactivate")}>Reativar</Button>
            )}
          </>
        }
      >
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={statusTone(u.status)}>{USER_STATUS_LABEL[u.status]}</Badge>
          <Badge tone="primary">{ROLE_LABEL[u.role]}</Badge>
          {u.mfaEnabled ? <Badge tone="success">MFA ativo</Badge> : <Badge>MFA inativo</Badge>}
          {u.lockedUntil && <Badge tone="danger" icon={Lock}>Bloqueado até {formatDateTime(u.lockedUntil)}</Badge>}
        </div>
      </PageHeader>
      {u.status === "pending_approval" && (
        <Alert tone="warning" title="Aguardando liberação">
          {u.name} ativou o convite e pode fazer o primeiro acesso, mas só abre trilhas e conteúdos depois que você liberar.
        </Alert>
      )}
      {u.offboardAt && u.status !== "inactive" && (
        <Alert tone="warning" icon={CalendarClock} title={`Desligamento agendado para ${formatDateTime(u.offboardAt)}`}>
          <p>Motivo: {u.offboardReason ?? "—"}. No horário, o acesso é trancado automaticamente.</p>
          <Button className="mt-2" size="sm" variant="outline" loading={cancelOffboard.isPending} onClick={() => cancelOffboard.mutate(undefined)}>
            Cancelar agendamento
          </Button>
        </Alert>
      )}
      {u.status === "inactive" && u.offboardReason && (
        <Alert tone="neutral" icon={DoorClosed} title={`Desligado em ${formatDateTime(u.offboardAt ?? u.deactivatedAt)}`}>
          Motivo: {u.offboardReason}. O histórico de aprendizagem está preservado.
        </Alert>
      )}
      {offboarding && <OffboardModal user={u} onClose={() => setOffboarding(false)} />}
      {invite && (
        <Modal open onClose={() => setInvite(null)} title={invite.kind === "reset" ? "Redefinição de senha" : "Convite"}>
          <InviteResult link={invite.link} kind={invite.kind} onClose={() => setInvite(null)} />
        </Modal>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dados e organização" action={!edit && <Button size="sm" variant="outline" onClick={() => setEdit({ name: u.name, role: u.role, jobTitleId: u.jobTitleId ?? "", departmentId: u.departmentId ?? "", teamId: u.teamId ?? "" })}>Editar</Button>} />
          <div className="p-5">
            {edit ? (
              <div className="space-y-3">
                <Field label="Nome" htmlFor="e-name"><Input id="e-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                <Field label="Perfil" htmlFor="e-role" hint="Mudar o perfil encerra as sessões do usuário."><Select id="e-role" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })} options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} /></Field>
                <Field label="Cargo" htmlFor="e-job"><Select id="e-job" value={edit.jobTitleId} onChange={(e) => setEdit({ ...edit, jobTitleId: e.target.value })} placeholder="—" options={(org.data?.jobTitles ?? []).map((j) => ({ value: j.id, label: j.name }))} /></Field>
                <Field label="Departamento" htmlFor="e-dep"><Select id="e-dep" value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })} placeholder="—" options={(org.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} /></Field>
                <Field label="Equipe" htmlFor="e-team"><Select id="e-team" value={edit.teamId} onChange={(e) => setEdit({ ...edit, teamId: e.target.value })} placeholder="—" options={(org.data?.teams ?? []).map((t) => ({ value: t.id, label: t.name }))} /></Field>
                <div className="flex gap-2"><Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Salvar</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button></div>
              </div>
            ) : (
              <KeyValue
                items={[
                  ["Cargo", name(org.data?.jobTitles, u.jobTitleId)],
                  ["Departamento", name(org.data?.departments, u.departmentId)],
                  ["Equipe", name(org.data?.teams, u.teamId)],
                  ["Criado em", formatDate(u.createdAt)],
                  ["Primeiro acesso", u.onboardingCompletedAt ? formatDate(u.onboardingCompletedAt) : "Pendente"],
                  ["Último login", formatDateTime(u.lastLoginAt)],
                ]}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Segurança" />
          <div className="flex flex-wrap gap-2 p-5">
            <ConfirmButton title="Redefinir MFA?" message="O usuário precisará configurar o aplicativo autenticador novamente no próximo login. As sessões serão encerradas." onConfirm={() => act.mutateAsync("reset-mfa")} icon={ShieldOff} confirmVariant="primary">Redefinir MFA</ConfirmButton>
            <Button size="sm" variant="outline" icon={KeyRound} onClick={() => act.mutate("unlock")} disabled={!u.lockedUntil}>Desbloquear</Button>
            <Button size="sm" variant="outline" icon={LogOut} onClick={() => act.mutate("revoke-sessions")}>Encerrar todas as sessões</Button>
            {(u.status === "active" || u.status === "pending_approval") && (
              <ConfirmButton title="Gerar link de redefinição de senha?" message="O link é pessoal, de uso único e expira automaticamente. Sem SMTP configurado, ele aparece aqui para ser enviado por um canal corporativo seguro." confirmLabel="Gerar link" confirmVariant="primary" icon={KeyRound} onConfirm={() => act.mutateAsync("password-reset")}>Redefinir senha</ConfirmButton>
            )}
          </div>
          <ul className="divide-y divide-border px-5 pb-3 text-sm">
            {data.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs text-muted">{s.userAgent?.slice(0, 60) ?? "—"} · {s.ip ?? ""} · ativa {relativeTime(s.lastSeenAt)} {s.mfa ? "· MFA" : ""}</span>
                <Button size="sm" variant="ghost" onClick={() => revokeSession.mutate(s.id)}>Encerrar</Button>
              </li>
            ))}
            {!data.sessions.length && <li className="py-2 text-muted">Nenhuma sessão ativa.</li>}
          </ul>
        </Card>
        {u.role === "leader" && (
          <Card className="lg:col-span-2">
            <CardHeader
              title="Escopo do líder"
              description="Áreas e equipes que o líder acompanha. Áreas, trilhas, conteúdos e o banco de questões são alterados somente pelo administrador."
              action={!scope && <Button size="sm" variant="outline" onClick={() => setScope({ areas: data.leaderAreas.map((a) => a.areaId), teams: data.leaderTeams.map((t) => t.teamId) })}>Editar escopo</Button>}
            />
            <div className="p-5">
              {scope ? (
                <div className="grid gap-6 md:grid-cols-2">
                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-sm font-medium">Áreas</legend>
                    {(areas.data ?? []).map((a) => (
                      <Checkbox key={a.id} label={a.name} checked={scope.areas.includes(a.id)} onChange={(on) => setScope({ ...scope, areas: on ? [...scope.areas, a.id] : scope.areas.filter((x) => x !== a.id) })} />
                    ))}
                  </fieldset>
                  <fieldset className="space-y-2">
                    <legend className="mb-1 text-sm font-medium">Equipes</legend>
                    {(org.data?.teams ?? []).map((t) => (
                      <Checkbox key={t.id} label={t.name} checked={scope.teams.includes(t.id)} onChange={(on) => setScope({ ...scope, teams: on ? [...scope.teams, t.id] : scope.teams.filter((x) => x !== t.id) })} />
                    ))}
                  </fieldset>
                  <div className="flex gap-2 md:col-span-2"><Button loading={saveScope.isPending} onClick={() => saveScope.mutate(undefined)}>Salvar escopo</Button><Button variant="ghost" onClick={() => setScope(null)}>Cancelar</Button></div>
                </div>
              ) : (
                <div className="grid gap-4 text-sm md:grid-cols-2">
                  <div>
                    <p className="font-medium">Áreas</p>
                    {data.leaderAreas.length ? data.leaderAreas.map((a) => <p key={a.areaId} className="text-muted">{a.name}</p>) : <p className="text-muted">Nenhuma área.</p>}
                  </div>
                  <div>
                    <p className="font-medium">Equipes</p>
                    {data.leaderTeams.length ? data.leaderTeams.map((t) => <p key={t.teamId} className="text-muted">{t.name}</p>) : <p className="text-muted">Nenhuma equipe.</p>}
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}
        <Card className="lg:col-span-2">
          <CardHeader title="Trilhas e acesso efetivo" action={<Button size="sm" variant="outline" onClick={() => void access.refetch()}>Ver acesso efetivo</Button>} />
          <div className="space-y-4 p-5">
            {data.enrollments.length ? (
              <ul className="divide-y divide-border text-sm">
                {data.enrollments.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{e.title} <span className="text-xs text-muted">· {e.source === "self" ? "iniciada pelo usuário" : "atribuída"}{e.dueDate ? ` · prazo ${formatDate(e.dueDate)}` : ""}</span></span>
                    <span className="text-xs">{LEARNER_TRACK_STATUS_LABEL[e.status]} · {e.percent}%</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nenhuma matrícula.</p>
            )}
            {access.data && (
              <TableWrap>
                <thead><tr><th className={th}>Trilha</th><th className={th}>Acesso</th><th className={th}>Motivo</th></tr></thead>
                <tbody>
                  {access.data.map((a) => (
                    <tr key={a.trackId}>
                      <td className={td}>{a.title}<p className="text-xs text-muted">{a.areaName}</p></td>
                      <td className={td}><Badge tone={a.access === "full" ? "success" : a.access === "partial" ? "info" : "neutral"}>{a.access === "full" ? "Total" : a.access === "partial" ? "Parcial" : "Sem acesso"}</Badge></td>
                      <td className={td}>{a.explanation}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </div>
        </Card>
        {u.status === "inactive" && (
          <Card className="border-danger/30 p-5 lg:col-span-2">
            <h2 className="font-heading font-semibold text-danger">Anonimizar dados pessoais (LGPD)</h2>
            <p className="mt-1 text-sm text-muted">Remove nome, e-mail, anotações, marcadores, notificações e o conteúdo dos comentários. Registros agregados de aprendizado são mantidos sem identificação. Ação irreversível.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Input aria-label="Digite ANONIMIZAR para confirmar" placeholder="Digite ANONIMIZAR" value={anon} onChange={(e) => setAnon(e.target.value)} className="max-w-xs" />
              <Button variant="danger" disabled={anon !== "ANONIMIZAR"} onClick={() => act.mutate("anonymize")}>Anonimizar</Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/** Modelo de desligamento: tranca o acesso agora ou na data informada, com motivo registrado na auditoria. */
function OffboardModal({ user, onClose }: { user: UserDetail["user"]; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [at, setAt] = useState("");
  const url = `/api/admin/users/${user.id}`;
  const scheduledAt = when === "schedule" && at ? new Date(at) : null;
  const run = useAction(() => api.post<{ scheduled: boolean }>(`${url}/offboard`, { reason: reason.trim(), at: scheduledAt ? scheduledAt.toISOString() : null }), {
    invalidate: [url, "/api/admin/users"],
    success: (r) => (r.scheduled ? "Desligamento agendado." : "Acesso trancado. Desligamento concluído."),
    onSuccess: onClose,
  });
  const invalid = reason.trim().length < 3 || (when === "schedule" && (!scheduledAt || scheduledAt.getTime() <= Date.now()));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Desligamento de ${user.name}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" icon={DoorClosed} loading={run.isPending} disabled={invalid} onClick={() => run.mutate(undefined)}>
            {when === "now" ? "Trancar acesso agora" : "Agendar desligamento"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-subtle/60 p-4 text-sm">
          <p className="font-medium">O que acontece no desligamento</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            <li>O login é bloqueado e todas as sessões abertas são encerradas.</li>
            <li>Links de convite e de redefinição de senha deixam de valer.</li>
            <li>Lideranças de equipes e áreas são removidas.</li>
            <li>O histórico de aprendizagem, notas e certificados é preservado.</li>
            <li>A anonimização (LGPD) pode ser feita depois, nesta mesma ficha.</li>
          </ul>
        </div>
        <Field label="Motivo (uso interno)" htmlFor="off-reason" required hint="Registrado na auditoria. Ex.: encerramento do contrato, transferência.">
          <Textarea id="off-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Quando trancar o acesso</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="off-when" checked={when === "now"} onChange={() => setWhen("now")} className="h-4 w-4 accent-[var(--primary)]" /> Agora
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="off-when" checked={when === "schedule"} onChange={() => setWhen("schedule")} className="h-4 w-4 accent-[var(--primary)]" /> Agendar para uma data e hora
          </label>
          {when === "schedule" && (
            <Input aria-label="Data e hora do desligamento" type="datetime-local" className="max-w-xs" value={at} onChange={(e) => setAt(e.target.value)} />
          )}
        </fieldset>
      </div>
    </Modal>
  );
}
