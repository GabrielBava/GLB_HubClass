import { Link } from "react-router";
import { Compass, ShieldAlert } from "lucide-react";
import { Button } from "../components/ui";

export function AccessDeniedPage({ message }: { message?: string }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-danger/10 text-danger">
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
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-subtle text-muted">
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
