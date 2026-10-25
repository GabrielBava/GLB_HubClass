import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MailCheck } from "lucide-react";
import { AuthLayout, AuthTitle } from "../../components/AuthLayout";
import { Button, Field, Input, PasswordInput, Spinner } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";

const dark = "h-12 bg-white/[0.04] border-white/10";

export function passwordHint(min: number) {
  return `Mínimo de ${min} caracteres, com letras e números. Não use nomes, datas ou senhas já utilizadas.`;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>("/api/auth/password/forgot", { email });
      setSent(r.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout>
      <AuthTitle title="Recuperar acesso" subtitle="Informe o e-mail corporativo cadastrado. Enviaremos um link seguro, válido por tempo limitado, para criar uma nova senha." />
      {sent ? (
        <div className="space-y-6">
          <p className="flex gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm text-white" role="status">
            <MailCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            {sent}
          </p>
          <Link to="/entrar" className="block text-center text-sm font-medium text-primary hover:underline">Voltar para o login</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <Field label="E-mail" htmlFor="email" error={error}>
            <Input id="email" type="email" autoComplete="email" placeholder="seu@email.com.br" value={email} onChange={(e) => setEmail(e.target.value)} className={dark} />
          </Field>
          <Button type="submit" size="lg" glow className="w-full" loading={loading} disabled={!email}>Enviar link de recuperação</Button>
          <Link to="/entrar" className="block text-center text-sm text-white/60 hover:text-white">Voltar para o login</Link>
        </form>
      )}
    </AuthLayout>
  );
}

function PasswordForm({ min, onSubmit, submitLabel, fields }: { min: number; onSubmit: (pwd: string) => Promise<void>; submitLabel: string; fields?: ReactNode }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mismatch = confirm.length > 0 && confirm !== password;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return;
    setLoading(true);
    setError(null);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-5">
      {fields}
      <Field label="Nova senha" htmlFor="pwd" hint={passwordHint(min)} error={error}>
        <PasswordInput id="pwd" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={dark} />
      </Field>
      <Field label="Confirme a senha" htmlFor="pwd2" error={mismatch ? "As senhas não coincidem." : null}>
        <PasswordInput id="pwd2" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={dark} invalid={mismatch} />
      </Field>
      <Button type="submit" size="lg" glow className="w-full" loading={loading} disabled={password.length < min || password !== confirm}>
        {submitLabel}
      </Button>
    </form>
  );
}

export function ResetPasswordPage() {
  const { token = "" } = useParams();
  const [done, setDone] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["reset", token],
    queryFn: () => api.get<{ valid: boolean; passwordMinLength: number }>(`/api/auth/password/reset/${encodeURIComponent(token)}`),
    retry: false,
  });
  return (
    <AuthLayout>
      <AuthTitle title="Criar nova senha" />
      {isLoading ? (
        <Spinner />
      ) : done ? (
        <div className="space-y-6">
          <p className="flex gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm text-white" role="status">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            Senha alterada. Por segurança, todas as sessões abertas foram encerradas.
          </p>
          <Link to="/entrar" className="block text-center font-medium text-primary hover:underline">Entrar com a nova senha</Link>
        </div>
      ) : !data?.valid ? (
        <div className="space-y-4 text-white/70">
          <p>Este link é inválido, já foi usado ou expirou.</p>
          <Link to="/recuperar-acesso" className="font-medium text-primary hover:underline">Solicitar um novo link</Link>
        </div>
      ) : (
        <PasswordForm
          min={data.passwordMinLength}
          submitLabel="Salvar nova senha"
          onSubmit={async (password) => {
            await api.post("/api/auth/password/reset", { token, password });
            setDone(true);
          }}
        />
      )}
    </AuthLayout>
  );
}

const steps = [
  "Você receberá um convite no seu e-mail corporativo, enviado pelo administrador do LIFE CLASS. Não há cadastro aberto.",
  "Abra o link do convite (ele é pessoal, de uso único e tem validade limitada).",
  "Crie uma senha segura seguindo as orientações da tela.",
  "Líderes e administradores configuram a verificação em duas etapas com um aplicativo autenticador.",
  "No primeiro acesso, conheça a plataforma, registre a ciência dos termos de confidencialidade e veja a sua jornada de formação.",
];

export function OnboardingStepsAside({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h2 className="font-heading text-2xl font-bold text-white sm:text-3xl">{title}</h2>
      <p className="text-lg text-white/70">Seja bem-vindo(a)! Siga os passos abaixo para ativar seu acesso:</p>
      <ol className="space-y-4 text-[15px] leading-relaxed text-white/75">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="font-semibold text-white">{i + 1}.</span> {s}
          </li>
        ))}
      </ol>
      <p className="font-medium text-primary">Pronto! Use este espaço para expandir seus horizontes e crescer junto conosco.</p>
    </div>
  );
}

export function FirstAccessManualPage() {
  return (
    <AuthLayout aside={<OnboardingStepsAside title="Como ativar seu acesso ao LIFE CLASS?" />}>
      <AuthTitle title="Primeiro acesso" subtitle="O acesso ao LIFE CLASS é liberado por convite. Se você ainda não recebeu, fale com seu líder ou com a área de Pessoas." />
      <div className="space-y-3 text-sm text-white/65">
        <p>Já recebeu o convite? Abra o link do e-mail para criar sua senha.</p>
        <p>Esqueceu a senha de uma conta já ativa? Use a recuperação de acesso.</p>
      </div>
      <div className="mt-8 flex flex-col gap-3">
        <Link to="/entrar"><Button size="lg" glow className="w-full">Ir para o login</Button></Link>
        <Link to="/recuperar-acesso" className="text-center text-sm font-medium text-primary hover:underline">Recuperar acesso</Link>
      </div>
    </AuthLayout>
  );
}

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.get<{ name: string; email: string; requiresMfa: boolean; passwordMinLength: number }>(`/api/auth/invite/${encodeURIComponent(token)}`),
    retry: false,
  });
  return (
    <AuthLayout aside={<OnboardingStepsAside title="Como ativar seu acesso ao LIFE CLASS?" />}>
      <AuthTitle title="Ative sua conta" subtitle="Crie sua senha para começar" />
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <div className="space-y-4 text-white/70">
          <p role="alert">{errorMessage(error)}</p>
          <Link to="/entrar" className="font-medium text-primary hover:underline">Ir para o login</Link>
        </div>
      ) : (
        <PasswordForm
          min={data.passwordMinLength}
          submitLabel="Ativar conta"
          fields={
            <>
              <Field label="Nome completo" htmlFor="name">
                <Input id="name" value={data.name} readOnly className={dark} />
              </Field>
              <Field label="E-mail" htmlFor="inv-email">
                <Input id="inv-email" value={data.email} readOnly className={dark} />
              </Field>
            </>
          }
          onSubmit={async (password) => {
            const r = await api.post<{ status: string }>("/api/auth/invite/accept", { token, password });
            await refresh();
            navigate(r.status === "mfa_setup_required" ? "/entrar/configurar-mfa?next=%2Fprimeiro-acesso" : "/primeiro-acesso", { replace: true });
          }}
        />
      )}
      <p className="mt-8 text-center text-sm text-white/60">
        Já tem uma conta? <Link to="/entrar" className="font-medium text-primary hover:underline">Entrar</Link>
      </p>
    </AuthLayout>
  );
}
