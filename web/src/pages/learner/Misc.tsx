import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Bell, CheckCheck, Download, KeyRound, LogOut, Monitor, RefreshCw, ShieldCheck, Smartphone } from "lucide-react";
import { ROLE_LABEL, type Role } from "../../../../shared/domain";
import { HowToUse } from "../../components/HowToUse";
import { useToast } from "../../components/toast";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, KeyValue, Modal, PageHeader, PageLoader, PasswordInput, Switch, cx } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, formatDateTime, relativeTime } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { passwordHint } from "../auth/Recovery";

interface NotificationList {
  unread: number;
  items: { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[];
}

export function NotificationsPage() {
  const { data, isLoading, error, refetch } = useApi<NotificationList>("/api/notifications");
  const navigate = useNavigate();
  useDocumentTitle("Notificações");
  const readAll = useAction(() => api.post("/api/notifications/read-all"), { invalidate: ["/api/notifications"] });
  const open = async (n: NotificationList["items"][number]) => {
    if (!n.readAt) await api.post(`/api/notifications/${n.id}/read`).catch(() => undefined);
    void refetch();
    if (n.link) navigate(n.link);
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notificações"
        description="Avisos sobre trilhas, prazos, avaliações e feedbacks. Ajuste o envio por e-mail no seu perfil."
        actions={data?.unread ? <Button variant="outline" icon={CheckCheck} onClick={() => readAll.mutate(undefined)}>Marcar todas como lidas</Button> : undefined}
      />
      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState error={error} retry={refetch} />
      ) : !data.items.length ? (
        <EmptyState icon={Bell} title="Nenhuma notificação" />
      ) : (
        <Card className="divide-y divide-border">
          {data.items.map((n) => (
            <button key={n.id} onClick={() => void open(n)} className={cx("flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-subtle", !n.readAt && "bg-primary/5")}>
              <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-label={n.readAt ? undefined : "Não lida"} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{n.title}</span>
                {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                <span className="mt-0.5 block text-xs text-muted">{relativeTime(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

export function HelpPage() {
  const { me } = useAuth();
  const { data } = useApi<{ supportContact: string; dataProtectionContact: string; platformName: string }>("/api/onboarding");
  useDocumentTitle("Ajuda");
  const faq: [string, string][] = [
    ["Por que uma trilha aparece com cadeado?", "Os conteúdos são liberados conforme cargo, área e plano de desenvolvimento. Abra a trilha e use “Solicitar acesso” — o pedido vai para o administrador e para os líderes da área."],
    ["Como o progresso de leitura é calculado?", "Uma página conta como lida depois de alguns segundos de leitura ativa (com interação). Deixar o documento aberto sem interagir não conta como estudo."],
    ["Posso baixar ou imprimir as apostilas?", "Não. Os materiais internos são exibidos apenas no leitor, com marca d'água individual. Alguns conteúdos autorizados podem ter download liberado pelo administrador."],
    ["Quem vê minhas anotações?", "Ninguém além de você. Dúvidas só ficam visíveis quando você escolhe publicá-las no espaço de comentários do conteúdo."],
    ["O que o meu líder acompanha?", "Progresso nas trilhas, notas das avaliações, entregas práticas e datas de atividade. Não há monitoramento de horários de uso."],
    ["Concluir uma trilha substitui certificações profissionais?", "Não. As trilhas internas não substituem habilitações exigidas por órgãos reguladores (ex.: certificações do mercado financeiro)."],
  ];
  return (
    <div className="space-y-8">
      <PageHeader title="Ajuda e suporte" description="Reveja as instruções do primeiro acesso, tire dúvidas frequentes e fale com o suporte." actions={<Link to="/primeiro-acesso"><Button variant="outline">Rever boas-vindas</Button></Link>} />
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Como utilizar</h2>
        <HowToUse supportContact={data?.supportContact} />
      </section>
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Perguntas frequentes</h2>
        <div className="space-y-2">
          {faq.map(([q, a]) => (
            <details key={q} className="group rounded-xl border border-border bg-card p-4">
              <summary className="cursor-pointer list-none font-medium marker:hidden">{q}</summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
      <Card className="p-5 text-sm">
        <h2 className="font-heading text-base font-semibold">Contato</h2>
        <KeyValue
          items={[
            ["Suporte da plataforma", data?.supportContact ?? "—"],
            ["Encarregado de proteção de dados", data?.dataProtectionContact ?? "—"],
            ["Seu identificador", me?.user.code ?? "—"],
          ]}
        />
      </Card>
    </div>
  );
}

interface ProfileData {
  name: string;
  email: string;
  code: string;
  role: Role;
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  preferences: { emailNotifications: boolean };
  termsAcceptances: { version: string; acceptedAt: string }[];
  privacy: { contact: string; retention: { readingSessionsDays: number; notificationsDays: number; auditDays: number } };
}

interface SessionItem {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

function describeAgent(ua: string | null) {
  if (!ua) return "Navegador desconhecido";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` · ${os}` : ""}`;
}

export function ProfilePage() {
  const { data, isLoading, error, refetch } = useApi<ProfileData>("/api/profile");
  const sessions = useApi<SessionItem[]>("/api/auth/sessions");
  const { logout } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });
  const [codesModal, setCodesModal] = useState(false);
  const [totp, setTotp] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  useDocumentTitle("Meu perfil");
  const changePwd = useAction(() => api.post("/api/auth/password/change", { currentPassword: pwd.current, newPassword: pwd.next }), {
    success: "Senha alterada. As outras sessões foram encerradas.",
    invalidate: ["/api/auth/sessions", "/api/profile"],
    onSuccess: () => setPwd({ current: "", next: "", confirm: "" }),
  });
  const prefs = useAction((v: boolean) => api.patch("/api/profile/preferences", { emailNotifications: v }), { invalidate: ["/api/profile"], success: "Preferência salva." });
  const revoke = useAction((id: string) => api.del(`/api/auth/sessions/${id}`), { invalidate: ["/api/auth/sessions"], success: "Sessão encerrada." });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Meu perfil" description="Dados da conta, segurança, sessões, notificações e privacidade." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Dados da conta" />
          <div className="p-5">
            <KeyValue
              items={[
                ["Nome", data.name],
                ["E-mail", data.email],
                ["Identificador", data.code],
                ["Perfil", ROLE_LABEL[data.role]],
                ["Último acesso", formatDateTime(data.lastLoginAt)],
              ]}
            />
            <p className="mt-3 text-xs text-muted">Para alterar nome, e-mail, cargo ou área, fale com o administrador.</p>
          </div>
        </Card>
        <Card>
          <CardHeader title="Verificação em duas etapas" icon={ShieldCheck} />
          <div className="space-y-3 p-5 text-sm">
            {data.mfaEnabled ? (
              <>
                <p className="flex items-center gap-2">
                  <Badge tone="success">Ativa</Badge> desde {formatDate(data.mfaEnabledAt)}
                </p>
                <Button variant="outline" size="sm" icon={RefreshCw} onClick={() => { setCodes(null); setTotp(""); setCodesModal(true); }}>
                  Gerar novos códigos de recuperação
                </Button>
              </>
            ) : (
              <>
                <p className="text-muted">Proteja sua conta com um código do aplicativo autenticador a cada login.</p>
                <Link to="/entrar/configurar-mfa?next=%2Fperfil">
                  <Button size="sm" icon={Smartphone}>Ativar verificação em duas etapas</Button>
                </Link>
              </>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Alterar senha" icon={KeyRound} />
          <form
            className="space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (pwd.next !== pwd.confirm) return toast.error("As senhas não coincidem.");
              changePwd.mutate(undefined);
            }}
          >
            <Field label="Senha atual" htmlFor="pw-cur">
              <PasswordInput id="pw-cur" autoComplete="current-password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
            </Field>
            <Field label="Nova senha" htmlFor="pw-new" hint={passwordHint(10)}>
              <PasswordInput id="pw-new" autoComplete="new-password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
            </Field>
            <Field label="Confirme a nova senha" htmlFor="pw-conf">
              <PasswordInput id="pw-conf" autoComplete="new-password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
            </Field>
            <Button type="submit" loading={changePwd.isPending} disabled={!pwd.current || !pwd.next}>Alterar senha</Button>
          </form>
        </Card>
        <Card>
          <CardHeader
            title="Sessões ativas"
            icon={Monitor}
            action={
              <Button
                size="sm"
                variant="outline"
                icon={LogOut}
                onClick={async () => {
                  await api.post("/api/auth/logout-all");
                  await logout();
                  navigate("/entrar", { replace: true });
                }}
              >
                Sair de todas
              </Button>
            }
          />
          <ul className="divide-y divide-border px-5 py-2">
            {(sessions.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {describeAgent(s.userAgent)} {s.current && <Badge tone="primary">Esta sessão</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    Iniciada {formatDateTime(s.createdAt)} · ativa {relativeTime(s.lastSeenAt)}
                    {s.ip ? ` · IP ${s.ip}` : ""}
                  </p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                    Encerrar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Notificações" icon={Bell} />
          <div className="p-5">
            <Switch checked={data.preferences.emailNotifications} onChange={(v) => prefs.mutate(v)} label="Receber avisos por e-mail" description="Trilhas atribuídas, prazos, correções e feedbacks (quando o envio de e-mails estiver ativo)." />
          </div>
        </Card>
        <Card>
          <CardHeader title="Privacidade e meus dados" icon={ShieldCheck} />
          <div className="space-y-3 p-5 text-sm">
            <p className="text-muted">
              Tratamos seus dados de identificação, de uso educacional e de segurança para a gestão da capacitação. Retenção: sessões de leitura por {data.privacy.retention.readingSessionsDays} dias, notificações por {data.privacy.retention.notificationsDays} dias e registros de auditoria por {data.privacy.retention.auditDays} dias.
            </p>
            <div>
              <p className="font-medium">Ciência dos termos</p>
              <ul className="text-muted">
                {data.termsAcceptances.map((t) => (
                  <li key={t.version}>
                    Versão {t.version} — {formatDateTime(t.acceptedAt)}
                  </li>
                ))}
              </ul>
            </div>
            <a href="/api/profile/data-export">
              <Button variant="outline" size="sm" icon={Download}>Exportar meus dados</Button>
            </a>
            <p className="text-xs text-muted">Encarregado de dados: {data.privacy.contact}</p>
          </div>
        </Card>
      </div>
      <Modal open={codesModal} onClose={() => setCodesModal(false)} title="Novos códigos de recuperação" size="sm">
        {codes ? (
          <div className="space-y-3">
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-subtle p-3 font-mono text-sm">
              {codes.map((c) => <li key={c}>{c}</li>)}
            </ul>
            <p className="text-xs text-muted">Os códigos anteriores deixaram de valer. Guarde estes em local seguro.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="Código atual do aplicativo" htmlFor="totp-regen">
              <Input id="totp-regen" inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} />
            </Field>
            <Button
              disabled={totp.length !== 6}
              onClick={async () => {
                try {
                  const r = await api.post<{ recoveryCodes: string[] }>("/api/auth/mfa/recovery-codes", { code: totp });
                  setCodes(r.recoveryCodes);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}
            >
              Gerar códigos
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
