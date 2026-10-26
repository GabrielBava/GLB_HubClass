import { useState } from "react";
import { Building, Briefcase, Check, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { Button, Card, CardHeader, ConfirmButton, ErrorState, Input, PageHeader, PageLoader, Select } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import type { Org } from "./Users";

function OrgList({
  title,
  icon,
  path,
  items,
  departments,
  extra,
}: {
  title: string;
  icon: typeof Building;
  path: "departments" | "teams" | "job-titles";
  items: { id: string; name: string; departmentId?: string | null }[];
  departments?: { id: string; name: string }[];
  extra?: (id: string) => string | null;
}) {
  const [name, setName] = useState("");
  const [dep, setDep] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const inv = { invalidate: ["/api/admin/org"] };
  const create = useAction(() => api.post(`/api/admin/${path}`, { name, departmentId: dep || null }), { ...inv, success: "Item criado.", onSuccess: () => setName("") });
  const rename = useAction(() => api.patch(`/api/admin/${path}/${editing!.id}`, { name: editing!.name }), { ...inv, success: "Item atualizado.", onSuccess: () => setEditing(null) });
  const remove = useAction((id: string) => api.del(`/api/admin/${path}/${id}`), { ...inv, success: "Item excluído." });
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      <div className="space-y-2 p-5">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate(undefined);
          }}
        >
          <div className="flex gap-2">
            <Input aria-label={`Novo item em ${title}`} placeholder="Novo nome" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="submit" icon={Plus} loading={create.isPending} aria-label="Adicionar" />
          </div>
          {departments && <Select aria-label="Departamento" value={dep} onChange={(e) => setDep(e.target.value)} placeholder="Departamento (opcional)" options={departments.map((d) => ({ value: d.id, label: d.name }))} />}
        </form>
        <ul className="divide-y divide-border">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 py-2 text-sm">
              {editing?.id === it.id ? (
                <>
                  <Input aria-label="Novo nome" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="h-9" />
                  <Button size="icon" variant="ghost" icon={Check} aria-label="Salvar" onClick={() => rename.mutate(undefined)} />
                  <Button size="icon" variant="ghost" icon={X} aria-label="Cancelar" onClick={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <span className="flex-1">
                    {it.name}
                    {extra?.(it.id) && <span className="block text-xs text-muted">{extra(it.id)}</span>}
                  </span>
                  <Button size="icon" variant="ghost" icon={Pencil} aria-label={`Renomear ${it.name}`} onClick={() => setEditing({ id: it.id, name: it.name })} />
                  <ConfirmButton title="Excluir item?" message="Usuários vinculados ficarão sem este vínculo. Regras de acesso que o usam deixam de ter efeito." onConfirm={() => remove.mutateAsync(it.id)} variant="ghost" size="icon" icon={Trash2}>
                    <span className="sr-only">Excluir {it.name}</span>
                  </ConfirmButton>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function OrganizationPage() {
  const { data, isLoading, error, refetch } = useApi<Org>("/api/admin/org");
  useDocumentTitle("Organização");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  return (
    <div>
      <PageHeader title="Organização" description="Departamentos, equipes e cargos usados nas permissões, nos relatórios e na atribuição de trilhas. Líderes de equipe são definidos no cadastro do usuário (escopo do líder)." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <OrgList title="Departamentos" icon={Building} path="departments" items={data.departments} />
        <OrgList
          title="Equipes"
          icon={Users}
          path="teams"
          items={data.teams}
          departments={data.departments}
          extra={(id) => {
            const t = data.teams.find((x) => x.id === id);
            if (!t) return null;
            return `${t.members} membro(s) ativo(s) · líder: ${t.leaders.map((l) => l.name).join(", ") || "não definido"}`;
          }}
        />
        <OrgList title="Cargos" icon={Briefcase} path="job-titles" items={data.jobTitles} departments={data.departments} />
      </div>
    </div>
  );
}
