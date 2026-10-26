import { useEffect } from "react";
import { Link } from "react-router";
import { Compass, Hourglass, LogOut, ShieldAlert } from "lucide-react";
import { AuthLayout, AuthTitle } from "../components/AuthLayout";
import { Button } from "../components/ui";
import { useAuth } from "../lib/auth";

export function AccessDeniedPage({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-danger/40 text-danger">
        <ShieldAlert className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-5 font-heading text-2xl font-bold">Acesso negado</h1>
      <p className="mt-2 text-muted">{message ?? "Você não tem permissão para acessar esta página ou conteúdo. Se acredita que deveria ter acesso, fale com seu líder."}</p>
      <Link to="/" className="mt-6 inline-block">
        <Button variant="outline">Voltar ao início</Button>
      </Link>
    </div>
  );
}

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-border-strong text-muted">
        <Compass className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-5 font-heading text-2xl font-bold">Página não encontrada</h1>
      <p className="mt-2 text-muted">O endereço pode ter mudado ou o conteúdo não está mais disponível.</p>
      <Link to="/" className="mt-6 inline-block">
        <Button variant="outline">Voltar ao início</Button>
      </Link>
    </div>
  );
}

/** Conta ativada, aguardando a liberação do administrador. Verifica sozinha de tempos em tempos. */
export function AwaitingApprovalPage() {
  const { me, refresh, logout } = useAuth();
  useEffect(() => {
    const t = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(t);
  }, [refresh]);
  const firstName = me?.user.name.split(" ")[0] ?? "";
  return (
    <AuthLayout>
      <span className="mb-6 grid h-12 w-12 place-items-center rounded-full border border-border-strong text-icon">
        <Hourglass className="h-6 w-6" aria-hidden />
      </span>
      <AuthTitle title={`Quase lá, ${firstName}!`} subtitle="Seu acesso foi ativado e aguarda a liberação do administrador." />
      <div className="space-y-4 text-sm leading-relaxed text-muted">
        <p>Assim que o acesso for liberado, você recebe um aviso e as trilhas aparecem automaticamente nesta tela.</p>
        {!me?.onboardingCompleted && <p>Enquanto isso, você já pode conhecer a plataforma e registrar a ciência dos termos no primeiro acesso.</p>}
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        {!me?.onboardingCompleted && (
          <Link to="/primeiro-acesso">
            <Button size="lg" glow>Fazer o primeiro acesso</Button>
          </Link>
        )}
        <Button size="lg" variant="ghost" className="text-fg hover:bg-pill-hover" icon={LogOut} onClick={() => void logout()}>
          Sair
        </Button>
      </div>
    </AuthLayout>
  );
}
