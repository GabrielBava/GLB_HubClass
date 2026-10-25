import { useRef, useState } from "react";
import { ImageUp, Mail, Trash2 } from "lucide-react";
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABEL } from "../../../../shared/domain";
import { FONT_CHOICES, type AllSettings } from "../../../../shared/settings";
import { Brand } from "../../components/Brand";
import { Alert, Button, Card, CardHeader, Checkbox, ErrorState, Field, Input, PageHeader, PageLoader, Select, Switch, Tabs, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { readableOn, useBranding } from "../../lib/branding";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { NumberFields, SaveBar, useSettingsGroup, type SettingsResponse } from "./Security";

type Tab = "branding" | "catalog" | "reading" | "assessment" | "notifications" | "onboarding";

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("branding");
  const { data, isLoading, error, refetch } = useApi<SettingsResponse>("/api/admin/settings");
  useDocumentTitle("Configurações");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  return (
    <div>
      <PageHeader title="Configurações" description="Identidade visual, catálogo, leitura, avaliações, notificações e boas-vindas. Tudo sem alterar código." />
      <Tabs<Tab>
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "branding", label: "Identidade visual" },
          { id: "catalog", label: "Catálogo e comunidade" },
          { id: "reading", label: "Leitura" },
          { id: "assessment", label: "Avaliações" },
          { id: "notifications", label: "Notificações" },
          { id: "onboarding", label: "Primeiro acesso" },
        ]}
      />
      {tab === "branding" && <BrandingTab data={data} />}
      {tab === "catalog" && <CatalogTab data={data} />}
      {tab === "reading" && <ReadingTab data={data} />}
      {tab === "assessment" && <AssessmentTab data={data} />}
      {tab === "notifications" && <NotificationsTab data={data} />}
      {tab === "onboarding" && <OnboardingTab data={data} />}
    </div>
  );
}

/** Contraste WCAG entre duas cores hex. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const n = hex.replace("#", "");
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const c = parseInt(n.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

function ColorField({ id, label, hint, value, onChange }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} (seletor)`} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="h-11 w-14 cursor-pointer rounded-xl border border-border bg-input p-1" />
        <Input id={id} value={value} maxLength={7} onChange={(e) => onChange(e.target.value)} className="font-mono uppercase" />
      </div>
    </Field>
  );
}

function BrandingTab({ data }: { data: SettingsResponse }) {
  const { value, setValue, save, dirty } = useSettingsGroup(data, "branding", [["branding"]]);
  const { branding } = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const brandingInv = { invalidate: ["/api/admin/settings", ["branding"]] };
  const removeLogo = useAction(() => api.del("/api/admin/settings/logo"), { ...brandingInv, success: "Logotipo removido." });
  const uploadLogo = useAction(
    (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.upload("/api/admin/settings/logo", fd);
    },
    { ...brandingInv, success: "Logotipo atualizado." },
  );
  if (!value) return null;
  const validHex = (h: string) => /^#[0-9a-fA-F]{6}$/.test(h);
  const colorsOk = validHex(value.colors.primary) && validHex(value.colors.brandSurface) && validHex(value.colors.accent);
  const onSurface = colorsOk ? contrast(value.colors.primary, value.colors.brandSurface) : 0;
  const onWhite = colorsOk ? contrast(value.colors.primary, "#FFFFFF") : 0;

  const { logoFileId: _logo, ...payload } = value;
  void _logo;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="p-5">
        <CardHeader title="Identidade visual" description="Nome, cores e tipografia são aplicados em toda a plataforma, inclusive nas telas de acesso." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Nome da plataforma" htmlFor="b-name">
            <Input id="b-name" value={value.platformName} onChange={(e) => setValue({ ...value, platformName: e.target.value })} />
          </Field>
          <Field label="Organização" htmlFor="b-org">
            <Input id="b-org" value={value.organizationName} onChange={(e) => setValue({ ...value, organizationName: e.target.value })} />
          </Field>
          <Field label="Frase institucional" htmlFor="b-tag" className="sm:col-span-2">
            <Textarea id="b-tag" className="min-h-[72px]" value={value.tagline} onChange={(e) => setValue({ ...value, tagline: e.target.value })} />
          </Field>
          <Field label="Mensagem da tela de login" htmlFor="b-login" className="sm:col-span-2">
            <Input id="b-login" value={value.loginMessage} onChange={(e) => setValue({ ...value, loginMessage: e.target.value })} />
          </Field>
          <ColorField id="b-primary" label="Cor principal" hint="Botões, links e progresso." value={value.colors.primary} onChange={(v) => setValue({ ...value, colors: { ...value.colors, primary: v } })} />
          <ColorField id="b-accent" label="Cor secundária" hint="Detalhes e gradientes." value={value.colors.accent} onChange={(v) => setValue({ ...value, colors: { ...value.colors, accent: v } })} />
          <ColorField id="b-surface" label="Cor institucional" hint="Menu lateral e painel das telas de acesso." value={value.colors.brandSurface} onChange={(v) => setValue({ ...value, colors: { ...value.colors, brandSurface: v } })} />
          <Field label="Modo padrão" htmlFor="b-mode" hint="Cada pessoa pode trocar no próprio menu.">
            <Select id="b-mode" value={value.defaultMode} onChange={(e) => setValue({ ...value, defaultMode: e.target.value as AllSettings["branding"]["defaultMode"] })} options={[{ value: "light", label: "Claro" }, { value: "dark", label: "Escuro" }, { value: "system", label: "Seguir o sistema" }]} />
          </Field>
          <Field label="Fonte dos títulos" htmlFor="b-fh">
            <Select id="b-fh" value={value.fonts.heading} onChange={(e) => setValue({ ...value, fonts: { ...value.fonts, heading: e.target.value } })} options={FONT_CHOICES.map((f) => ({ value: f, label: f }))} />
          </Field>
          <Field label="Fonte do texto" htmlFor="b-fb">
            <Select id="b-fb" value={value.fonts.body} onChange={(e) => setValue({ ...value, fonts: { ...value.fonts, body: e.target.value } })} options={FONT_CHOICES.map((f) => ({ value: f, label: f }))} />
          </Field>
        </div>
        {colorsOk && onWhite < 2.2 && (
          <div className="mt-4">
            <Alert tone="warning">A cor principal tem pouco contraste com fundos claros ({onWhite.toFixed(1)}:1). Textos sobre ela são ajustados automaticamente, mas ícones e bordas podem ficar pouco visíveis.</Alert>
          </div>
        )}
        <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(payload)} />
      </Card>

      <div className="space-y-5">
        <Card className="p-5">
          <CardHeader title="Prévia" description="Como o painel institucional e os botões ficarão." />
          <div className="mt-4 overflow-hidden rounded-2xl p-5" style={{ background: colorsOk ? `radial-gradient(400px 220px at 0% 0%, ${value.colors.primary}44, transparent 70%), ${value.colors.brandSurface}` : undefined }}>
            <p className="text-lg font-semibold text-white" style={{ fontFamily: `"${value.fonts.heading}", system-ui` }}>
              {value.platformName}
            </p>
            <p className="mt-1 text-sm text-white/70" style={{ fontFamily: `"${value.fonts.body}", system-ui` }}>
              {value.tagline}
            </p>
            <button type="button" tabIndex={-1} className="mt-4 rounded-full px-5 py-2 text-sm font-semibold" style={{ background: value.colors.primary, color: colorsOk ? readableOn(value.colors.primary) : undefined }}>
              Entrar
            </button>
          </div>
          {colorsOk && <p className="mt-2 text-xs text-muted">Contraste da cor principal sobre a cor institucional: {onSurface.toFixed(1)}:1</p>}
        </Card>
        <Card className="p-5">
          <CardHeader title="Logotipo" description="PNG, JPEG ou WebP de até 1 MB. Sem logotipo, o nome da plataforma é exibido." />
          <div className="mt-4 flex min-h-[72px] items-center justify-center rounded-xl p-4" style={{ background: branding.colors.brandSurface }}>
            <Brand />
          </div>
          <div className="mt-3 flex gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadLogo.mutate(f);
                e.target.value = "";
              }} />
            <Button variant="outline" icon={ImageUp} loading={uploadLogo.isPending} onClick={() => fileRef.current?.click()}>
              Enviar logotipo
            </Button>
            {data.settings.branding.logoFileId && (
              <Button variant="ghost" icon={Trash2} loading={removeLogo.isPending} onClick={() => removeLogo.mutate(undefined)}>
                Remover
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function CatalogTab({ data }: { data: SettingsResponse }) {
  const catalog = useSettingsGroup(data, "catalog");
  const community = useSettingsGroup(data, "community");
  if (!catalog.value || !community.value) return null;
  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <CardHeader title="Catálogo" description="Como conteúdos não autorizados aparecem para o colaborador." />
        <div className="mt-4 space-y-4">
          <Field label="Conteúdo sem permissão" htmlFor="cat-vis">
            <Select
              id="cat-vis"
              value={catalog.value.lockedVisibility}
              onChange={(e) => catalog.setValue({ ...catalog.value!, lockedVisibility: e.target.value as "locked" | "hidden" })}
              options={[
                { value: "locked", label: "Mostrar bloqueado (com cadeado e pedido de acesso)" },
                { value: "hidden", label: "Ocultar completamente" },
              ]}
            />
          </Field>
          <Switch label="Permitir pedidos de acesso" description="O colaborador pode solicitar liberação de trilhas bloqueadas ao líder." checked={catalog.value.allowAccessRequests} onChange={(v) => catalog.setValue({ ...catalog.value!, allowAccessRequests: v })} />
          <p className="text-xs text-muted">Cada trilha pode sobrescrever a forma de exibição no editor da trilha.</p>
        </div>
        <SaveBar dirty={catalog.dirty} loading={catalog.save.isPending} onSave={() => catalog.save.mutate(catalog.value!)} />
      </Card>
      <Card className="p-5">
        <CardHeader title="Dúvidas e comentários" description="Comentários compartilhados ficam visíveis para quem acessa o mesmo conteúdo; anotações são sempre privadas." />
        <div className="mt-4">
          <Switch label="Comentários habilitados por padrão" description="Áreas e conteúdos podem desativar individualmente." checked={community.value.commentsEnabledDefault} onChange={(v) => community.setValue({ ...community.value!, commentsEnabledDefault: v })} />
        </div>
        <SaveBar dirty={community.dirty} loading={community.save.isPending} onSave={() => community.save.mutate(community.value!)} />
      </Card>
    </div>
  );
}

function ReadingTab({ data }: { data: SettingsResponse }) {
  const { value, setValue, save, dirty } = useSettingsGroup(data, "reading");
  if (!value) return null;
  const sample = Math.ceil(12_000 / Math.max(50, value.wordsPerMinute || 200));
  return (
    <Card className="max-w-4xl p-5">
      <CardHeader title="Tempo de leitura" description="Base do tempo estimado das apostilas. Áreas e conteúdos podem ter valores próprios ou tempo manual." />
      <div className="mt-4 space-y-4">
        <NumberFields
          value={value as unknown as Record<string, unknown>}
          onChange={(v) => setValue(v as unknown as AllSettings["reading"])}
          fields={[
            { key: "wordsPerMinute", label: "Palavras por minuto", hint: `Uma apostila de 12 mil palavras ≈ ${sample} min.`, min: 80, max: 600 },
            { key: "minutesPerPageFallback", label: "Minutos por página (PDF sem texto)", hint: "Para documentos digitalizados.", min: 0.5, max: 20, step: 0.5 },
            { key: "minPageSeconds", label: "Tempo mínimo por página (s)", hint: "Tempo ativo para considerar uma página lida.", min: 1, max: 300 },
            { key: "completionThreshold", label: "Páginas lidas para concluir (%)", min: 50, max: 100 },
            { key: "idleSeconds", label: "Pausar contagem após inatividade (s)", hint: "Sem interação, o tempo ativo deixa de contar.", min: 30, max: 1800 },
          ]}
        />
        <Switch label="Modo texto acessível por padrão" description="Permite ler o texto extraído da apostila (leitores de tela e ampliação). Também protegido por permissão." checked={value.allowTextModeDefault} onChange={(v) => setValue({ ...value, allowTextModeDefault: v })} />
        <Alert tone="info">O sistema distingue tempo estimado, tempo de visualização e tempo de leitura ativa. Abrir o documento não conta como leitura.</Alert>
      </div>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(value)} />
    </Card>
  );
}

function AssessmentTab({ data }: { data: SettingsResponse }) {
  const { value, setValue, save, dirty } = useSettingsGroup(data, "assessment");
  if (!value) return null;
  return (
    <Card className="max-w-3xl p-5">
      <CardHeader title="Padrões das avaliações" description="Aplicados às novas avaliações. Cada área e cada avaliação podem ter valores próprios." />
      <div className="mt-4">
        <NumberFields
          value={value as unknown as Record<string, unknown>}
          onChange={(v) => setValue(v as unknown as AllSettings["assessment"])}
          fields={[
            { key: "defaultPassingScore", label: "Nota mínima de aprovação (%)", min: 0, max: 100 },
            { key: "defaultMaxAttempts", label: "Tentativas permitidas", hint: "Vazio = ilimitadas.", min: 1, max: 50 },
          ]}
        />
      </div>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(value)} />
    </Card>
  );
}

function NotificationsTab({ data }: { data: SettingsResponse }) {
  const { value, setValue, save, dirty } = useSettingsGroup(data, "notifications");
  const test = useAction(() => api.post("/api/admin/settings/test-email"), { success: "E-mail de teste enviado para o seu endereço." });
  if (!value) return null;
  return (
    <Card className="max-w-4xl p-5">
      <CardHeader title="Notificações" description="Todas as notificações aparecem na plataforma. O envio por e-mail depende do servidor SMTP." />
      <div className="mt-4 space-y-5">
        {!data.environment.smtp && <Alert tone="warning">SMTP não configurado. Os e-mails ficam registrados na caixa de saída do servidor até a configuração.</Alert>}
        <Switch label="Enviar também por e-mail" checked={value.emailEnabled} onChange={(v) => setValue({ ...value, emailEnabled: v })} />
        <fieldset disabled={!value.emailEnabled}>
          <legend className="mb-2 text-sm font-medium">Tipos enviados por e-mail</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {NOTIFICATION_TYPES.map((t) => (
              <Checkbox key={t} label={NOTIFICATION_TYPE_LABEL[t]} checked={value.emailTypes.includes(t)} onChange={(on) => setValue({ ...value, emailTypes: on ? [...value.emailTypes, t] : value.emailTypes.filter((x) => x !== t) })} />
            ))}
          </div>
        </fieldset>
        <Field label="Avisar sobre prazo com antecedência de (dias)" htmlFor="n-days">
          <Input id="n-days" type="number" min={1} max={30} className="max-w-[160px]" value={value.deadlineReminderDays} onChange={(e) => setValue({ ...value, deadlineReminderDays: Number(e.target.value) })} />
        </Field>
        <Button variant="outline" icon={Mail} disabled={!data.environment.smtp} loading={test.isPending} onClick={() => test.mutate(undefined)}>
          Enviar e-mail de teste
        </Button>
      </div>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(value)} />
    </Card>
  );
}

function OnboardingTab({ data }: { data: SettingsResponse }) {
  const { value, setValue, save, dirty } = useSettingsGroup(data, "onboarding");
  if (!value) return null;
  return (
    <Card className="max-w-3xl p-5">
      <CardHeader title="Primeiro acesso" description="Mensagem de boas-vindas da etapa 1 e contato de suporte exibido na ajuda." />
      <div className="mt-4 space-y-4">
        <Field label="Mensagem de boas-vindas" htmlFor="o-msg">
          <Textarea id="o-msg" className="min-h-[160px]" value={value.welcomeMessage} onChange={(e) => setValue({ ...value, welcomeMessage: e.target.value })} />
        </Field>
        <Field label="Contato de suporte" htmlFor="o-support">
          <Input id="o-support" value={value.supportContact} onChange={(e) => setValue({ ...value, supportContact: e.target.value })} />
        </Field>
        <p className="text-xs text-muted">O termo de confidencialidade é gerenciado em Segurança e privacidade › Termos de uso.</p>
      </div>
      <SaveBar dirty={dirty} loading={save.isPending} onSave={() => save.mutate(value)} />
    </Card>
  );
}
