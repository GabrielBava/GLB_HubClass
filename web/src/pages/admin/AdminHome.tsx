import { Link } from "react-router";
import { AlertTriangle, BookOpen, Building, CalendarClock, ChartColumn, FileWarning, FolderTree, Hourglass, Inbox, KeyRound, Monitor, ScrollText, Settings, Shield, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Alert, Card, CardHeader, ErrorState, PageHeader, PageLoader, StatCard } from "../../components/ui";
import { formatDateTime } from "../../lib/format";
import { useApi, useDocumentTitle } from "../../lib/hooks";

interface Overview {
  users: { active: number; invited: number; inactive: number; pendingApproval: number; scheduledOffboardings: number };
  tracks: { published: number; draft: number; review: number; archived: number };
  activeSessions: number;
  documents: { failed: number; processing: number };
  openRequests: number;
  pendingValidations: number;
  adminsWithoutMfa: number;
  recentDenials: { id: number; at: string; action: string; actorEmail: string | null; targetType: string | null; targetId: string | null }[];
  warnings: string[];
}

const LINKS = [
  { to: "/admin/usuarios", label: "Usuários e convites", icon: UserPlus },
  { to: "/admin/conteudos", label: "Áreas e trilhas", icon: FolderTree },
  { to: "/admin/permissoes", label: "Permissões", icon: KeyRound },
  { to: "/admin/organizacao", label: "Organização", icon: Building },
  { to: "/admin/relatorios", label: "Relatórios", icon: ChartColumn },
  { to: "/admin/auditoria", label: "Auditoria", icon: ScrollText },
  { to: "/admin/seguranca", label: "Segurança", icon: Shield },
  { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
];

export function AdminHomePage() {
  const { data, isLoading, error, refetch } = useApi<Overview>("/api/admin/overview");
  useDocumentTitle("Painel administrativo");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  return (
    <div className="space-y-6">
      <PageHeader title="Painel administrativo" description="Visão geral da plataforma, pendências e alertas de segurança." />
      {data.users.pendingApproval > 0 && (
        <Alert tone="warning" icon={Hourglass} title={`${data.users.pendingApproval} pessoa(s) aguardando liberação de acesso`}>
          <Link to="/admin/usuarios?status=pending_approval" className="font-medium text-primary hover:underline">
            Revisar e liberar
          </Link>
        </Alert>
      )}
      {data.users.scheduledOffboardings > 0 && (
        <Alert tone="info" icon={CalendarClock} title={`${data.users.scheduledOffboardings} desligamento(s) agendado(s)`}>
          O acesso é trancado automaticamente na data definida em cada ficha de usuário.
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Usuários ativos" value={data.users.active} hint={`${data.users.invited} convite(s) pendente(s)`} icon={Users} />
        <StatCard label="Trilhas publicadas" value={data.tracks.published} hint={`${data.tracks.draft} rascunho(s) · ${data.tracks.review} em revisão`} icon={BookOpen} />
        <StatCard label="Sessões ativas" value={data.activeSessions} icon={Monitor} tone="info" />
        <StatCard label="Validações pendentes" value={data.pendingValidations} icon={ShieldCheck} tone="warning" />
        <StatCard label="Solicitações abertas" value={data.openRequests} icon={Inbox} tone="warning" />
        <StatCard label="Documentos com falha" value={data.documents.failed} hint={data.documents.processing ? `${data.documents.processing} em processamento` : undefined} icon={FileWarning} tone={data.documents.failed ? "danger" : "neutral"} />
      </div>
      {(data.warnings.length > 0 || data.adminsWithoutMfa > 0) && (
        <div className="space-y-2">
          {data.adminsWithoutMfa > 0 && <Alert tone="danger" icon={AlertTriangle} title={`${data.adminsWithoutMfa} administrador(es) ativo(s) sem MFA configurado`}>O MFA será exigido no próximo login dessas contas.</Alert>}
          {data.warnings.map((w) => (
            <Alert key={w} tone="warning" icon={AlertTriangle}>{w}</Alert>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Acesso rápido" />
          <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            {LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-center text-sm hover:border-primary hover:text-primary">
                <l.icon className="h-5 w-5" aria-hidden />
                {l.label}
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Acessos negados recentes" description="Tentativas bloqueadas pelas regras de autorização" action={<Link to="/admin/auditoria?outcome=denied" className="text-sm text-primary hover:underline">Auditoria</Link>} />
          <ul className="divide-y divide-border px-5 py-2 text-sm">
            {data.recentDenials.map((d) => (
              <li key={d.id} className="py-2.5">
                <p className="font-medium">{d.action}</p>
                <p className="text-xs text-muted">{d.actorEmail ?? "anônimo"} · {d.targetType ?? ""} {d.targetId?.slice(0, 8) ?? ""} · {formatDateTime(d.at)}</p>
              </li>
            ))}
            {!data.recentDenials.length && <li className="py-4 text-muted">Nenhuma negativa registrada.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
