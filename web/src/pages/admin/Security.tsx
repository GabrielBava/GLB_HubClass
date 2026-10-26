import { useEffect, useState } from "react";
import type { QueryKey } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, FileSignature, LogOut, Plus, Save, Server } from "lucide-react";
import { ROLE_LABEL, type Role } from "../../../../shared/domain";
import type { AllSettings } from "../../../../shared/settings";
import { Alert, Badge, Button, Card, CardHeader, ConfirmButton, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Tabs, TableWrap, Textarea, td, th } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDateTime, relativeTime } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";

export interface SettingsResponse {
  settings: AllSettings;
  environment: { database: string; storage: string; smtp: boolean; antivirus: boolean; docxConversion: boolean; cookieSecure: boolean; environment: string };
}

/** Formulário numérico genérico para um grupo de configurações. */
export function NumberFields<T extends Record<string, unknown>>({
  value,
  onChange,
  fields,
}: {
  value: T;
  onChange: (v: T) => void;
  fields: { key: keyof T & string; label: string; hint?: string; min: number; max: number; step?: number }[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <Field key={f.key} label={f.label} htmlFor={`n-${f.key}`} hint={f.hint}>
          <Input
            id={`n-${f.key}`}
            type="number"
            min={f.min}
            max={f.max}
            step={f.step ?? 1}
            value={(value[f.key] as number | null) ?? ""}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </Field>
      ))}
    </div>
  );
}

/** Estado local de um grupo de configurações, com salvar e restaurar. */
export function useSettingsGroup<K extends keyof AllSettings>(data: SettingsResponse | undefined, group: K, extraInvalidate: (string | QueryKey)[] = []) {
  const [value, setValue] = useState<AllSettings[K] | null>(null);
  useEffect(() => {
    if (data) setValue(data.settings[group]);
  }, [data, group]);
  const save = useAction((v: Partial<AllSettings[K]>) => api.put(`/api/admin/settings/${group}`, v), { invalidate: ["/api/admin/settings", ...extraInvalidate], success: "Configurações salvas." });
  const dirty = !!data && !!value && JSON.stringify(value) !== JSON.stringify(data.settings[group]);
  return { value, setValue, save, dirty };
}

function SaveBar({ dirty, loading, onSave }: { dirty: boolean; loading: boolean; onSave: () => void }) {
  return (
    <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
      {dirty && <span className="text-xs text-muted">Alterações não salvas</span>}
      <Button icon={Save} loading={loading} disabled={!dirty} onClick={onSave}>
        Salvar
      </Button>
    </div>
  );
}

interface SessionRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
  userAgent: string | null;
  mfa: boolean;
}
interface TermsRow {
  id: string;
  version: string;
  title: string;
  body: string;
  isCurrent: boolean;
  publishedAt: string;
  acceptances: number;
}

type Tab = "policy" | "sessions" | "terms" | "privacy";

export function SecurityPage() {
  const [tab, setTab] = useState<Tab>("policy");
  const { data, isLoading, error, refetch } = useApi<SettingsResponse>("/api/admin/settings");
  useDocumentTitle("Segurança e privacidade");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  return (
    <div>
      <PageHeader title="Segurança e privacidade" description="Políticas de acesso, sessões ativas, termos de confidencialidade e retenção de dados (LGPD)." />
      <EnvironmentCard env={data.environment} />
      <Tabs<Tab>
        className="my-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "policy", label: "Política de acesso" },
          { id: "sessions", label: "Sessões ativas" },
          { id: "terms", label: "Termos de uso" },
          { id: "privacy", label: "Privacidade e retenção" },
        ]}
      />
      {tab === "policy" && <PolicyTab data={data} />}
      {tab === "sessions" && <SessionsTab />}
      {tab === "terms" && <TermsTab />}
      {tab === "privacy" && <PrivacyTab data={data} />}
    </div>
  );
}

function EnvironmentCard({ env }: { env: SettingsResponse["environment"] }) {
  const items: { label: string; ok: boolean; detail: string }[] = [
    { label: "Banco de dados", ok: env.database === "PostgreSQL", detail: env.database },
    { label: "Armazenamento de arquivos", ok: true, detail: env.storage },
    { label: "Cookies seguros (HTTPS)", ok: env.cookieSecure, detail: env.cookieSecure ? "Ativo" : "Desativado (somente desenvolvimento)" },
    { label: "E-mail (SMTP)", ok: env.smtp, detail: env.smtp ? "Configurado" : "Não configurado: convites e avisos ficam na caixa de saída do servidor" },
    { label: "Antivírus (ClamAV)", ok: env.antivirus, detail: env.antivirus ? "Arquivos verificados no envio" : "Não configurado: envios são aceitos apenas após validação de formato" },
    { label: "Conversão de DOCX", ok: env.docxConversion, detail: env.docxConversion ? "LibreOffice disponível" : "Desativada: envie apostilas em PDF" },
  ];
  return (
    <Card className="p-5">
      <CardHeader flush icon={Server} title="Ambiente" description={`Execução: ${env.environment}. Itens dependem de infraestrutura e são configurados por variáveis de ambiente.`} />
      <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <li key={i.label} className="flex items-start gap-2.5 rounded-xl border border-border p-3 text-sm">
            {i.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="OK" /> : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-label="Atenção" />}
            <span>
              <span className="block font-medium">{i.label}</span>
              <span className="text-xs text-muted">{i.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PolicyTab({ data }: { data: SettingsResponse }) {
  const { value, setValue, save, dirty } = useSettingsGroup(data, "security");
  if (!value) return null;
  return (
    <Card className="max-w-4xl p-5">
      <CardHeader flush title="Sessão, senha e bloqueio" description="MFA é obrigatório para administradores e líderes. Senhas são armazenadas com Argon2id." />
      <div className="mt-4">
        <NumberFields
          value={value as unknown as Record<string, unknown>}
          onChange={(v) => setValue(v as unknown as AllSettings["security"])}
          fields={[
            { key: "sessionIdleMinutes", label: "Encerrar sessão após inatividade (min)", min: 5, max: 1440 },
            { key: "sessionAbsoluteHours", label: "Duração máxima da sessão (horas)", min: 1, max: 336 },
            { key: "maxFailedLogins", label: "Tentativas de login antes do bloqueio", min: 3, max: 20 },
            { key: "lockoutMinutes", label: "Tempo de bloqueio (min)", min: 1, max: 1440 },
            { key: "passwordMinLength", label: "Tamanho mínimo da senha", min: 8, max: 64 },
            { key: "inviteExpiryHours", label: "Validade do convite (horas)", min: 1, max: 336 },
            { key: "resetExpiryMinutes", label: "Validade do link de redefinição (min)", min: 10, max: 1440 },
            { key: "pageRequestsPerMinute", label: "Páginas de apostila por minuto (por usuário)", hint: "Acima disso, o leitor pausa e o evento é registrado.", min: 20, max: 600 },
            { key: "maxUploadMb", label: "Tamanho máximo de arquivo (MB)", min: 1, max: 200 },
          ]}
        />
      </div>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(value)} />
    </Card>
  );
}

function SessionsTab() {
  const { data, isLoading, error, refetch } = useApi<SessionRow[]>("/api/admin/sessions");
  const revoke = useAction((id: string) => api.del(`/api/admin/sessions/${id}`), { invalidate: ["/api/admin/sessions"], success: "Sessão encerrada." });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className={th}>Usuário</th>
          <th className={th}>Início</th>
          <th className={th}>Última atividade</th>
          <th className={th}>Origem</th>
          <th className={th}>MFA</th>
          <th className={th}>
            <span className="sr-only">Ações</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {data.map((s) => (
          <tr key={s.id}>
            <td className={td}>
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-muted">
                {s.email} · {ROLE_LABEL[s.role]}
              </p>
            </td>
            <td className={td}>{formatDateTime(s.createdAt)}</td>
            <td className={td}>{relativeTime(s.lastSeenAt)}</td>
            <td className={td}>
              <p>{s.ip ?? "—"}</p>
              <p className="max-w-[220px] truncate text-xs text-muted" title={s.userAgent ?? ""}>
                {s.userAgent ?? ""}
              </p>
            </td>
            <td className={td}>{s.mfa ? <Badge tone="success">Verificado</Badge> : <Badge>Não exigido</Badge>}</td>
            <td className={`${td} text-right`}>
              <ConfirmButton variant="ghost" icon={LogOut} title="Encerrar sessão" message={`A sessão de ${s.name} será encerrada imediatamente.`} confirmLabel="Encerrar" onConfirm={() => revoke.mutateAsync(s.id)}>
                Encerrar
              </ConfirmButton>
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

function TermsTab() {
  const { data, isLoading, error, refetch } = useApi<TermsRow[]>("/api/admin/terms");
  const [form, setForm] = useState<{ version: string; title: string; body: string } | null>(null);
  const [view, setView] = useState<TermsRow | null>(null);
  const publish = useAction(() => api.post("/api/admin/terms", form), { invalidate: ["/api/admin/terms"], success: "Nova versão publicada. Todos registrarão ciência no próximo acesso.", onSuccess: () => setForm(null) });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const current = data.find((t) => t.isCurrent);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">O aceite registra usuário, data, hora, versão e um identificador de rede protegido (HMAC). Publicar nova versão exige novo aceite de todos.</p>
        <Button icon={Plus} onClick={() => setForm({ version: "", title: current?.title ?? "Termo de uso e confidencialidade", body: current?.body ?? "" })}>
          Publicar nova versão
        </Button>
      </div>
      <TableWrap>
        <thead>
          <tr>
            <th className={th}>Versão</th>
            <th className={th}>Título</th>
            <th className={th}>Publicada em</th>
            <th className={th}>Aceites</th>
            <th className={th}>
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((t) => (
            <tr key={t.id}>
              <td className={td}>
                <span className="font-semibold">{t.version}</span> {t.isCurrent && <Badge tone="success">Vigente</Badge>}
              </td>
              <td className={td}>{t.title}</td>
              <td className={td}>{formatDateTime(t.publishedAt)}</td>
              <td className={td}>{t.acceptances}</td>
              <td className={`${td} text-right`}>
                <Button size="sm" variant="ghost" icon={FileSignature} onClick={() => setView(t)}>
                  Ler
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.title} · versão ${view.version}` : ""} size="lg">
        <div className="whitespace-pre-line text-sm leading-relaxed">{view?.body}</div>
      </Modal>
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title="Nova versão dos termos"
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button loading={publish.isPending} disabled={!form?.version.trim() || (form?.body.trim().length ?? 0) < 20} onClick={() => publish.mutate(undefined)}>
              Publicar
            </Button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Alert tone="warning">Ao publicar, a versão anterior deixa de valer e todos os usuários precisarão registrar ciência novamente antes de acessar conteúdos.</Alert>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[160px_1fr]">
              <Field label="Número da versão" htmlFor="t-ver" required>
                <Input id="t-ver" placeholder={current ? `Ex.: ${bump(current.version)}` : "1.0"} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
              </Field>
              <Field label="Título" htmlFor="t-title" required>
                <Input id="t-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
            </div>
            <Field label="Texto" htmlFor="t-body" required>
              <Textarea id="t-body" className="min-h-[320px]" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}

function bump(v: string) {
  const m = /^(\d+)\.(\d+)$/.exec(v);
  return m ? `${m[1]}.${Number(m[2]) + 1}` : `${v}.1`;
}

function PrivacyTab({ data }: { data: SettingsResponse }) {
  const { value, setValue, save, dirty } = useSettingsGroup(data, "privacy");
  if (!value) return null;
  return (
    <Card className="max-w-4xl p-5">
      <CardHeader flush title="Retenção de dados (LGPD)" description="Registros mais antigos que o prazo são removidos automaticamente uma vez por dia. A auditoria só é apagada pela rotina de retenção." />
      <div className="mt-4 space-y-4">
        <NumberFields
          value={value as unknown as Record<string, unknown>}
          onChange={(v) => setValue(v as unknown as AllSettings["privacy"])}
          fields={[
            { key: "auditRetentionDays", label: "Registros de auditoria (dias)", min: 180, max: 3650, hint: "Mínimo de 180 dias." },
            { key: "readingSessionRetentionDays", label: "Sessões de leitura detalhadas (dias)", min: 30, max: 3650, hint: "O progresso consolidado é mantido." },
            { key: "notificationRetentionDays", label: "Notificações (dias)", min: 30, max: 3650 },
          ]}
        />
        <Field label="Contato do encarregado de dados (DPO)" htmlFor="p-dpo" hint="Exibido no primeiro acesso, na central de ajuda e na exportação de dados pessoais.">
          <Input id="p-dpo" value={value.dataProtectionContact} onChange={(e) => setValue({ ...value, dataProtectionContact: e.target.value })} />
        </Field>
        <Alert tone="info">
          Cada colaborador pode exportar os próprios dados no perfil. A anonimização de ex-colaboradores é feita na ficha do usuário e preserva apenas estatísticas agregadas.
        </Alert>
      </div>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(value)} />
    </Card>
  );
}

export { SaveBar };
