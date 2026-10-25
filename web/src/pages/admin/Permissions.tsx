import { useState } from "react";
import { Ban, CheckCircle2, Plus, ShieldCheck, Trash2, UserCheck, Users as UsersIcon, XCircle } from "lucide-react";
import { ACCESS_RESOURCES, ACCESS_RESOURCE_LABEL, ACCESS_SUBJECTS, ACCESS_SUBJECT_LABEL, ROLES, ROLE_LABEL, type AccessResource, type AccessSubject, type Role } from "../../../../shared/domain";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Tabs, TableWrap, td, th } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import type { Org } from "./Users";

interface Rule {
  id: string;
  subjectType: AccessSubject;
  subjectId: string | null;
  subjectName: string;
  resourceType: AccessResource;
  resourceId: string;
  resourceName: string;
  effect: "allow" | "deny";
  note: string;
  grantedByName: string | null;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
}
interface TreeArea {
  id: string;
  name: string;
  tracks: { id: string; title: string; status: string }[];
}
interface TrackDetail {
  modules: { id: string; title: string; contents: { id: string; title: string }[] }[];
}
interface LiteUser {
  id: string;
  name: string;
  role: Role;
}

type ResourceSel = { areaId: string; trackId: string; moduleId: string; contentId: string };
const emptyResource: ResourceSel = { areaId: "", trackId: "", moduleId: "", contentId: "" };

function resolveResource(r: ResourceSel): { resourceType: AccessResource; resourceId: string } | null {
  if (r.contentId) return { resourceType: "content", resourceId: r.contentId };
  if (r.moduleId) return { resourceType: "module", resourceId: r.moduleId };
  if (r.trackId) return { resourceType: "track", resourceId: r.trackId };
  if (r.areaId) return { resourceType: "area", resourceId: r.areaId };
  return null;
}

/** Seleção hierárquica de recurso: área → trilha → módulo → conteúdo (o nível mais específico vale). */
function ResourcePicker({ value, onChange, idPrefix, maxLevel = "content" }: { value: ResourceSel; onChange: (v: ResourceSel) => void; idPrefix: string; maxLevel?: "track" | "content" }) {
  const { data: tree } = useApi<TreeArea[]>("/api/admin/content/tree");
  const { data: track } = useApi<TrackDetail>(value.trackId && maxLevel === "content" ? `/api/admin/tracks/${value.trackId}` : null);
  const area = tree?.find((a) => a.id === value.areaId);
  const mod = track?.modules.find((m) => m.id === value.moduleId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Área" htmlFor={`${idPrefix}-area`}>
        <Select id={`${idPrefix}-area`} value={value.areaId} placeholder="Selecione..." onChange={(e) => onChange({ ...emptyResource, areaId: e.target.value })} options={(tree ?? []).map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      <Field label="Trilha" htmlFor={`${idPrefix}-track`}>
        <Select
          id={`${idPrefix}-track`}
          value={value.trackId}
          disabled={!area}
          placeholder={maxLevel === "track" ? "Selecione..." : "Toda a área"}
          onChange={(e) => onChange({ ...value, trackId: e.target.value, moduleId: "", contentId: "" })}
          options={(area?.tracks ?? []).map((t) => ({ value: t.id, label: t.title }))}
        />
      </Field>
      {maxLevel === "content" && (
        <>
          <Field label="Módulo" htmlFor={`${idPrefix}-module`}>
            <Select id={`${idPrefix}-module`} value={value.moduleId} disabled={!track} placeholder="Toda a trilha" onChange={(e) => onChange({ ...value, moduleId: e.target.value, contentId: "" })} options={(track?.modules ?? []).map((m) => ({ value: m.id, label: m.title }))} />
          </Field>
          <Field label="Documento / conteúdo" htmlFor={`${idPrefix}-content`}>
            <Select id={`${idPrefix}-content`} value={value.contentId} disabled={!mod} placeholder="Todo o módulo" onChange={(e) => onChange({ ...value, contentId: e.target.value })} options={(mod?.contents ?? []).map((c) => ({ value: c.id, label: c.title }))} />
          </Field>
        </>
      )}
    </div>
  );
}

function SubjectPicker({ type, id, onChange, types, idPrefix }: { type: AccessSubject; id: string; onChange: (type: AccessSubject, id: string) => void; types: readonly AccessSubject[]; idPrefix: string }) {
  const { data: org } = useApi<Org>("/api/admin/org");
  const { data: people } = useApi<LiteUser[]>(type === "user" ? "/api/admin/users-lite" : null);
  const options: { value: string; label: string }[] =
    type === "user"
      ? (people ?? []).map((u) => ({ value: u.id, label: `${u.name} (${ROLE_LABEL[u.role]})` }))
      : type === "team"
        ? (org?.teams ?? []).map((t) => ({ value: t.id, label: t.name }))
        : type === "department"
          ? (org?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))
          : type === "job_title"
            ? (org?.jobTitles ?? []).map((j) => ({ value: j.id, label: j.name }))
            : type === "role"
              ? ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))
              : [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Aplicar a" htmlFor={`${idPrefix}-stype`}>
        <Select id={`${idPrefix}-stype`} value={type} onChange={(e) => onChange(e.target.value as AccessSubject, "")} options={types.map((s) => ({ value: s, label: ACCESS_SUBJECT_LABEL[s] }))} />
      </Field>
      {type !== "everyone" && (
        <Field label={ACCESS_SUBJECT_LABEL[type]} htmlFor={`${idPrefix}-sid`}>
          <Select id={`${idPrefix}-sid`} value={id} placeholder="Selecione..." onChange={(e) => onChange(type, e.target.value)} options={options} />
        </Field>
      )}
    </div>
  );
}

type Tab = "rules" | "bulk" | "check";

export function PermissionsPage() {
  const [tab, setTab] = useState<Tab>("rules");
  useDocumentTitle("Permissões");
  return (
    <div>
      <PageHeader
        title="Permissões"
        description="O acesso é negado por padrão. Libere por usuário, cargo, equipe, departamento, perfil ou para todos, no nível de área, trilha, módulo ou documento. Uma regra de negação sempre prevalece."
      />
      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "rules", label: "Regras de acesso" },
          { id: "bulk", label: "Atribuição em massa" },
          { id: "check", label: "Verificar acesso" },
        ]}
      />
      {tab === "rules" && <RulesTab />}
      {tab === "bulk" && <BulkTab />}
      {tab === "check" && <CheckTab />}
    </div>
  );
}

function RulesTab() {
  const [filter, setFilter] = useState<{ resourceType: string; effect: string }>({ resourceType: "", effect: "" });
  const params = new URLSearchParams();
  if (filter.resourceType) params.set("resourceType", filter.resourceType);
  const { data, isLoading, error, refetch } = useApi<Rule[]>(`/api/admin/access-rules?${params.toString()}`);
  const [form, setForm] = useState<{ subjectType: AccessSubject; subjectId: string; resource: ResourceSel; effect: "allow" | "deny"; note: string; expiresAt: string } | null>(null);
  const inv = { invalidate: ["/api/admin/access", "/api/catalog", "/api/tracks"] };
  const create = useAction(
    () => {
      const res = resolveResource(form!.resource)!;
      return api.post("/api/admin/access-rules", { subjectType: form!.subjectType, subjectId: form!.subjectType === "everyone" ? null : form!.subjectId, ...res, effect: form!.effect, note: form!.note, expiresAt: form!.expiresAt || null });
    },
    { ...inv, success: "Regra criada e registrada na auditoria.", onSuccess: () => setForm(null) },
  );
  const remove = useAction((id: string) => api.del(`/api/admin/access-rules/${id}`), { ...inv, success: "Regra removida. O acesso é revogado imediatamente." });
  const rows = (data ?? []).filter((r) => !filter.effect || r.effect === filter.effect);
  const ready = form && resolveResource(form.resource) && (form.subjectType === "everyone" || form.subjectId);

  return (
    <>
      <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="Nível" htmlFor="f-res" className="min-w-[180px]">
          <Select id="f-res" value={filter.resourceType} placeholder="Todos" onChange={(e) => setFilter({ ...filter, resourceType: e.target.value })} options={ACCESS_RESOURCES.map((r) => ({ value: r, label: ACCESS_RESOURCE_LABEL[r] }))} />
        </Field>
        <Field label="Efeito" htmlFor="f-eff" className="min-w-[160px]">
          <Select id="f-eff" value={filter.effect} placeholder="Todos" onChange={(e) => setFilter({ ...filter, effect: e.target.value })} options={[{ value: "allow", label: "Liberar" }, { value: "deny", label: "Bloquear" }]} />
        </Field>
        <Button className="ml-auto" icon={Plus} onClick={() => setForm({ subjectType: "job_title", subjectId: "", resource: emptyResource, effect: "allow", note: "", expiresAt: "" })}>
          Nova regra
        </Button>
      </Card>
      {isLoading ? (
        <PageLoader />
      ) : error ? (
        <ErrorState error={error} retry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nenhuma regra" description="Sem regras, apenas trilhas livres, trilhas atribuídas e áreas sob liderança ficam acessíveis." />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Efeito</th>
                  <th className={th}>Quem</th>
                  <th className={th}>O quê</th>
                  <th className={th}>Validade</th>
                  <th className={th}>Concedida por</th>
                  <th className={th}>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.expired ? "opacity-60" : ""}>
                    <td className={td}>
                      {r.effect === "allow" ? (
                        <Badge tone="success" icon={CheckCircle2}>
                          Liberar
                        </Badge>
                      ) : (
                        <Badge tone="danger" icon={Ban}>
                          Bloquear
                        </Badge>
                      )}
                    </td>
                    <td className={td}>
                      <p className="font-medium">{r.subjectType === "role" ? ROLE_LABEL[r.subjectName as Role] ?? r.subjectName : r.subjectName}</p>
                      <p className="text-xs text-muted">{ACCESS_SUBJECT_LABEL[r.subjectType]}</p>
                    </td>
                    <td className={td}>
                      <p className="font-medium">{r.resourceName}</p>
                      <p className="text-xs text-muted">{ACCESS_RESOURCE_LABEL[r.resourceType]}</p>
                      {r.note && <p className="mt-1 text-xs italic text-muted">{r.note}</p>}
                    </td>
                    <td className={td}>{r.expiresAt ? <span className={r.expired ? "text-danger" : ""}>{r.expired ? "Expirou em " : "Até "}{formatDate(r.expiresAt)}</span> : "Sem prazo"}</td>
                    <td className={td}>
                      <p>{r.grantedByName ?? "—"}</p>
                      <p className="text-xs text-muted">{formatDate(r.createdAt)}</p>
                    </td>
                    <td className={`${td} text-right`}>
                      <ConfirmButton variant="ghost" icon={Trash2} title="Remover regra" message="A regra deixa de valer imediatamente, inclusive para quem estiver com o conteúdo aberto." confirmLabel="Remover" onConfirm={() => remove.mutateAsync(r.id)}>
                        Remover
                      </ConfirmButton>
                    </td>
                  </tr>
                ))}
              </tbody>
          </TableWrap>
        </Card>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Nova regra de acesso"
        description="Vale para o nível escolhido e tudo o que estiver abaixo dele."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button loading={create.isPending} disabled={!ready} onClick={() => create.mutate(undefined)}>
              Criar regra
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-5">
            <Field label="Efeito" htmlFor="r-effect">
              <Select id="r-effect" value={form.effect} onChange={(e) => setForm({ ...form, effect: e.target.value as "allow" | "deny" })} options={[{ value: "allow", label: "Liberar acesso" }, { value: "deny", label: "Bloquear acesso (prevalece sobre liberações)" }]} />
            </Field>
            <SubjectPicker idPrefix="r" type={form.subjectType} id={form.subjectId} types={ACCESS_SUBJECTS} onChange={(subjectType, subjectId) => setForm({ ...form, subjectType, subjectId })} />
            <ResourcePicker idPrefix="r" value={form.resource} onChange={(resource) => setForm({ ...form, resource })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Válida até (opcional)" htmlFor="r-exp">
                <Input id="r-exp" type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
              </Field>
              <Field label="Observação" htmlFor="r-note" hint="Ex.: motivo da liberação ou bloqueio.">
                <Input id="r-note" value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
            </div>
            {form.effect === "allow" && form.subjectType === "everyone" && (
              <Alert tone="warning">Esta regra libera o recurso para todos os usuários ativos.</Alert>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function BulkTab() {
  const [state, setState] = useState<{ subjectType: AccessSubject; subjectId: string; resource: ResourceSel; dueDate: string; isMandatory: boolean }>({ subjectType: "job_title", subjectId: "", resource: emptyResource, dueDate: "", isMandatory: true });
  const assign = useAction(
    () => api.post<{ assigned: number }>("/api/admin/assignments/bulk", { trackId: state.resource.trackId, subjectType: state.subjectType, subjectId: state.subjectType === "everyone" ? null : state.subjectId, dueDate: state.dueDate || null, isMandatory: state.isMandatory }),
    { invalidate: ["/api/admin", "/api/leader"], success: (r) => `Trilha atribuída a ${r.assigned} colaborador(es). Eles foram notificados.` },
  );
  const ready = state.resource.trackId && (state.subjectType === "everyone" || state.subjectId);
  return (
    <Card className="max-w-3xl p-5">
      <CardHeader icon={UsersIcon} title="Atribuir trilha em massa" description="Matricula todos os usuários ativos do grupo escolhido. A atribuição concede acesso à trilha publicada e aparece no painel de cada colaborador." />
      <div className="mt-5 space-y-5">
        <SubjectPicker idPrefix="b" type={state.subjectType} id={state.subjectId} types={["job_title", "team", "department", "role", "everyone"]} onChange={(subjectType, subjectId) => setState({ ...state, subjectType, subjectId })} />
        <ResourcePicker idPrefix="b" maxLevel="track" value={state.resource} onChange={(resource) => setState({ ...state, resource })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prazo (opcional)" htmlFor="b-due">
            <Input id="b-due" type="date" value={state.dueDate} onChange={(e) => setState({ ...state, dueDate: e.target.value })} />
          </Field>
          <div className="pt-7">
            <Checkbox label="Trilha obrigatória" checked={state.isMandatory} onChange={(v) => setState({ ...state, isMandatory: v })} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button icon={UserCheck} loading={assign.isPending} disabled={!ready} onClick={() => assign.mutate(undefined)}>
            Atribuir
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CheckTab() {
  const [userId, setUserId] = useState("");
  const [resource, setResource] = useState<ResourceSel>(emptyResource);
  const [who, setWho] = useState<ResourceSel>(emptyResource);
  const { data: people } = useApi<LiteUser[]>("/api/admin/users-lite");
  const res = resolveResource(resource);
  const check = useApi<{ allowed: boolean; reason: string; explanation: string }>(userId && res ? `/api/admin/access/check?userId=${userId}&resourceType=${res.resourceType}&resourceId=${res.resourceId}` : null);
  const whoRes = resolveResource(who);
  const [whoOpen, setWhoOpen] = useState(false);
  const list = useApi<{ id: string; name: string; role: Role; explanation: string }[]>(whoOpen && whoRes ? `/api/admin/access/resource?resourceType=${whoRes.resourceType}&resourceId=${whoRes.resourceId}` : null);

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5">
        <CardHeader title="Este usuário pode acessar?" description="Mostra a decisão e o motivo, exatamente como o servidor avalia." />
        <div className="mt-4 space-y-4">
          <Field label="Usuário" htmlFor="c-user">
            <Select id="c-user" value={userId} placeholder="Selecione..." onChange={(e) => setUserId(e.target.value)} options={(people ?? []).map((u) => ({ value: u.id, label: `${u.name} (${ROLE_LABEL[u.role]})` }))} />
          </Field>
          <ResourcePicker idPrefix="c" value={resource} onChange={setResource} />
          {check.data && (
            <Alert tone={check.data.allowed ? "success" : "danger"} icon={check.data.allowed ? CheckCircle2 : XCircle} title={check.data.allowed ? "Acesso permitido" : "Acesso negado"}>
              {check.data.explanation}
            </Alert>
          )}
        </div>
      </Card>
      <Card className="p-5">
        <CardHeader title="Quem tem acesso?" description="Lista os usuários ativos que conseguem abrir o recurso e o motivo." />
        <div className="mt-4 space-y-4">
          <ResourcePicker idPrefix="w" value={who} onChange={(v) => { setWho(v); setWhoOpen(false); }} />
          <Button variant="outline" disabled={!whoRes} loading={list.isFetching} onClick={() => setWhoOpen(true)}>
            Consultar
          </Button>
          {whoOpen && list.data && (
            <div className="max-h-80 overflow-y-auto rounded-xl border border-border">
              {list.data.length === 0 ? (
                <p className="p-3 text-sm text-muted">Nenhum usuário ativo tem acesso.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {list.data.map((u) => (
                    <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span>
                        {u.name} <span className="text-xs text-muted">· {ROLE_LABEL[u.role]}</span>
                      </span>
                      <span className="text-right text-xs text-muted">{u.explanation}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
