import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { AlertTriangle } from "lucide-react";
import { AuthLayout, AuthTitle } from "../../components/AuthLayout";
import { Button, Field, Input, PasswordInput } from "../../components/ui";
import { api, errorMessage, safeNext } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBranding } from "../../lib/branding";

export function LoginPage() {
  const { me, refresh } = useAuth();
  const { branding } = useBranding();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (me?.mfa.satisfied) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ status: "ok" | "mfa_required" | "mfa_setup_required" }>("/api/auth/login", { email, password });
      await refresh();
      const q = `?next=${encodeURIComponent(next)}`;
      if (res.status === "mfa_required") navigate(`/entrar/verificacao${q}`, { replace: true });
      else if (res.status === "mfa_setup_required") navigate(`/entrar/configurar-mfa${q}`, { replace: true });
      else navigate(next, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthTitle title="Bem-vindo de volta" subtitle={branding.loginMessage} />
      {params.get("expirou") && !error && (
        <p className="mb-5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning" role="status">
          Sua sessão expirou. Entre novamente para continuar.
        </p>
      )}
      <form onSubmit={submit} className="space-y-5" noValidate>
        <Field label="E-mail" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" placeholder="seu@email.com.br" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-12 bg-white/[0.04] border-white/10" />
        </Field>
        <Field label="Senha" htmlFor="password">
          <PasswordInput id="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 bg-white/[0.04] border-white/10" />
        </Field>
        <div>
          <Link to="/recuperar-acesso" className="text-sm font-medium text-primary hover:underline">
            Esqueceu sua senha?
          </Link>
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <Button type="submit" size="lg" glow loading={loading} className="w-full" disabled={!email || !password}>
          Entrar
        </Button>
      </form>
      <div className="mt-8 text-center text-sm text-white/60">
        <p>Ainda não tem acesso?</p>
        <Link to="/primeiro-acesso/manual" className="font-medium text-primary hover:underline">
          Manual de primeiro acesso e ativação por convite
        </Link>
      </div>
    </AuthLayout>
  );
}
