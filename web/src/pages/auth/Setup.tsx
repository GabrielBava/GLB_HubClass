import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Copy, KeyRound } from "lucide-react";
import { AuthLayout, AuthTitle } from "../../components/AuthLayout";
import { Alert, Button, Field, Input, PageLoader } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";

interface SetupResult {
  inviteLink: string;
  emailed: boolean;
  expiresHours: number;
}

/**
 * Configuração inicial da plataforma vazia: cria o primeiro administrador com o código definido em
 * SETUP_TOKEN no painel da Vercel. Some assim que existe um administrador.
 */
export function SetupPage() {
  const status = useQuery({ queryKey: ["setup-status"], queryFn: () => api.get<{ available: boolean }>("/api/setup/status") });
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      setResult(await api.post<SetupResult>("/api/setup", { token: token.trim(), name, email }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (status.isLoading) return <PageLoader />;

  return (
    <AuthLayout>
      <AuthTitle title="Configuração inicial" subtitle="Crie o primeiro administrador da plataforma. Depois disso, todo acesso é feito por convite." />
      {result ? (
        <div className="space-y-5" role="status">
          <p className="flex gap-3 rounded-[14px] border border-success/30 bg-success/10 p-4 text-sm">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden />
            <span>
              Administrador criado. {result.emailed ? "O convite também foi enviado por e-mail." : "Abra o link abaixo para criar a senha."} O link é de uso único e vale por {result.expiresHours} h.
            </span>
          </p>
          <div className="space-y-2">
            <code className="block select-all break-all rounded-[10px] border border-border bg-subtle px-3 py-2 text-xs">{result.inviteLink}</code>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                icon={Copy}
                onClick={async () => {
                  await navigator.clipboard.writeText(result.inviteLink).catch(() => {});
                  setCopied(true);
                }}
              >
                {copied ? "Copiado" : "Copiar link"}
              </Button>
              <a href={result.inviteLink}>
                <Button size="sm">Abrir convite</Button>
              </a>
            </div>
          </div>
          <Alert tone="info">No primeiro login será exigida a verificação em duas etapas (aplicativo autenticador). Depois publique os termos de uso em Segurança e privacidade.</Alert>
        </div>
      ) : !status.data?.available ? (
        <div className="space-y-5">
          <Alert tone="info" title="Configuração inicial indisponível">
            A plataforma já tem administrador ou o código de configuração (SETUP_TOKEN) não foi definido no painel da hospedagem.
          </Alert>
          <Link to="/entrar" className="block text-center text-sm font-medium text-primary hover:underline">
            Ir para o login
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <Field label="Código de configuração" htmlFor="setup-token" required hint="O valor de SETUP_TOKEN definido nas variáveis de ambiente da Vercel.">
            <Input id="setup-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="h-12" />
          </Field>
          <Field label="Nome completo do administrador" htmlFor="setup-name" required>
            <Input id="setup-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className="h-12" />
          </Field>
          <Field label="E-mail corporativo" htmlFor="setup-email" required>
            <Input id="setup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" size="lg" icon={KeyRound} loading={loading} className="w-full" disabled={!token || name.trim().length < 3 || !email}>
            Criar administrador
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
