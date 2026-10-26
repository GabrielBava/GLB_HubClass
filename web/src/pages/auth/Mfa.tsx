import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { Copy, Download, KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import { AuthLayout, AuthTitle } from "../../components/AuthLayout";
import { Button, Checkbox, Field, Input, LifeTitle, Spinner } from "../../components/ui";
import { api, errorMessage, safeNext } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../components/toast";

function useMfaGuard() {
  const { me, loading } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  if (loading) return { state: "loading" as const, next, me: null };
  if (!me) return { state: "anon" as const, next, me: null };
  if (me.mfa.satisfied) return { state: "done" as const, next, me };
  return { state: "pending" as const, next, me };
}

export function MfaVerifyPage() {
  const g = useMfaGuard();
  const { refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (g.state === "loading") return <AuthLayout><Spinner /></AuthLayout>;
  if (g.state === "anon") return <Navigate to="/entrar" replace />;
  if (g.state === "done" || !g.me) return <Navigate to={g.next} replace />;
  if (!g.me.mfa.enabled) return <Navigate to={`/entrar/configurar-mfa?next=${encodeURIComponent(g.next)}`} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/auth/mfa/verify", useRecovery ? { recoveryCode: code } : { code });
      await refresh();
      navigate(g.next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthTitle title="Verificação em duas etapas" subtitle="Por segurança, perfis de liderança e administração confirmam o acesso com um código do aplicativo autenticador." />
      <form onSubmit={submit} className="space-y-5">
        <Field label={useRecovery ? "Código de recuperação" : "Código de 6 dígitos"} htmlFor="code" error={error}>
          <Input
            id="code"
            autoFocus
            inputMode={useRecovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            placeholder={useRecovery ? "xxxx-xxxx" : "000000"}
            value={code}
            onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="h-14 text-center text-2xl tracking-[0.4em]"
          />
        </Field>
        <Button type="submit" size="lg" glow className="w-full" loading={loading} disabled={useRecovery ? code.length < 8 : code.length !== 6}>
          Confirmar
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        <button className="text-primary hover:underline" onClick={() => { setUseRecovery((v) => !v); setCode(""); setError(null); }}>
          {useRecovery ? "Usar o código do aplicativo" : "Perdi o acesso ao aplicativo — usar código de recuperação"}
        </button>
        <button className="text-muted hover:text-fg" onClick={async () => { await logout(); navigate("/entrar", { replace: true }); }}>
          Entrar com outra conta
        </button>
      </div>
    </AuthLayout>
  );
}

export function MfaSetupPage() {
  const g = useMfaGuard();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Também atende quem ativa o MFA voluntariamente (sessão já liberada, MFA ainda inativo).
  const pending = !!g.me && !g.me.mfa.enabled;

  useEffect(() => {
    if (!pending || setup) return;
    api.post<{ qrDataUrl: string; secret: string }>("/api/auth/mfa/setup").then(setSetup).catch((e) => setError(errorMessage(e)));
  }, [pending, setup]);

  if (g.state === "loading") return <AuthLayout><Spinner /></AuthLayout>;
  if (g.state === "anon") return <Navigate to="/entrar" replace />;
  if (codes) {
    const text = codes.join("\n");
    return (
      <AuthLayout>
        <AuthTitle title="Guarde seus códigos de recuperação" subtitle="Cada código funciona uma única vez, caso você perca o acesso ao aplicativo autenticador." />
        <ul className="grid grid-cols-2 gap-2 rounded-[14px] border border-border bg-subtle p-4 font-mono text-sm text-fg">
          {codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" icon={Copy} onClick={() => { void navigator.clipboard?.writeText(text); toast.success("Códigos copiados."); }}>Copiar</Button>
          <Button variant="outline" size="sm" icon={Download} onClick={() => {
            const url = URL.createObjectURL(new Blob([`Códigos de recuperação — LIFE CLASS\n\n${text}\n`], { type: "text/plain" }));
            const a = document.createElement("a"); a.href = url; a.download = "codigos-recuperacao-lifeclass.txt"; a.click(); URL.revokeObjectURL(url);
          }}>Baixar</Button>
        </div>
        <div className="mt-6"><Checkbox checked={saved} onChange={setSaved} label="Guardei os códigos em local seguro" /></div>
        <Button size="lg" glow className="mt-6 w-full" disabled={!saved} onClick={() => navigate(g.next, { replace: true })}>Continuar</Button>
      </AuthLayout>
    );
  }
  if (!g.me) return <Navigate to="/entrar" replace />;
  if (g.me.mfa.enabled) return <Navigate to={g.state === "done" ? g.next : `/entrar/verificacao?next=${encodeURIComponent(g.next)}`} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ recoveryCodes: string[] }>("/api/auth/mfa/enable", { code });
      // Mostra os códigos antes de atualizar a sessão: com o MFA ativo, esta tela redirecionaria sem exibi-los.
      setCodes(r.recoveryCodes);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      aside={
        <div className="space-y-5 text-muted">
          <ShieldCheck className="h-10 w-10 text-primary" aria-hidden />
          <h2 className="life-title text-[1.6rem]">
            <LifeTitle text="Ative a verificação em duas etapas" />
          </h2>
          <ol className="space-y-3 text-[15px] leading-relaxed">
            <li className="flex gap-3"><Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />1. Instale um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password ou similar).</li>
            <li className="flex gap-3"><KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />2. Escaneie o QR code ao lado ou digite a chave manualmente.</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />3. Informe o código de 6 dígitos exibido no aplicativo.</li>
          </ol>
          <p className="text-sm text-muted">Obrigatório para administradores e líderes: protege as informações das equipes e os conteúdos da empresa.</p>
        </div>
      }
    >
      <AuthTitle title="Configurar autenticador" />
      {!setup ? (
        error ? <p role="alert" className="text-danger">{error}</p> : <Spinner label="Gerando chave..." />
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div className="flex flex-col items-center gap-3 rounded-[14px] border border-border bg-subtle p-5">
            <img src={setup.qrDataUrl} alt="QR code para configurar o aplicativo autenticador" className="h-48 w-48 rounded-xl bg-white p-2" />
            <p className="text-center text-xs text-muted">Chave para digitação manual:</p>
            <code className="select-all break-all rounded-lg bg-pill-hover px-3 py-1.5 text-center text-sm text-fg">{setup.secret}</code>
          </div>
          <Field label="Código de 6 dígitos" htmlFor="code" error={error}>
            <Input id="code" inputMode="numeric" autoComplete="one-time-code" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} className="h-14 text-center text-2xl tracking-[0.4em]" />
          </Field>
          <Button type="submit" size="lg" glow className="w-full" loading={loading} disabled={code.length !== 6}>Ativar e continuar</Button>
        </form>
      )}
    </AuthLayout>
  );
}
