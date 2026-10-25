import { BookOpen, ClipboardCheck, LifeBuoy, LineChart, MessageSquareText, NotebookPen, Route } from "lucide-react";

const ITEMS = [
  { icon: Route, title: "Acessar as trilhas", text: "No catálogo, filtre por área, cargo ou nível. Trilhas com cadeado exigem liberação — você pode solicitar acesso." },
  { icon: BookOpen, title: "Estudar as apostilas", text: "O leitor mostra páginas, sumário, tempo estimado e progresso. Ele retoma de onde você parou." },
  { icon: LineChart, title: "Acompanhar o progresso", text: "Em “Minha evolução”, veja o que foi estudado, avaliado, demonstrado e validado na prática." },
  { icon: ClipboardCheck, title: "Realizar exercícios", text: "Ao final dos módulos, responda aos exercícios de fixação. A nota mínima padrão é 80%." },
  { icon: NotebookPen, title: "Registrar anotações", text: "Anote e marque páginas enquanto lê. Suas anotações são privadas e podem ser buscadas depois." },
  { icon: MessageSquareText, title: "Consultar feedbacks", text: "Os retornos do seu líder e as correções das atividades ficam no painel e em “Minha evolução”." },
  { icon: LifeBuoy, title: "Solicitar suporte", text: "Dúvidas sobre a plataforma? Use a página de Ajuda ou fale com o suporte." },
];

export function HowToUse({ supportContact }: { supportContact?: string }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {ITEMS.map(({ icon: Icon, title, text }) => (
        <li key={title} className="rounded-xl border border-border p-4">
          <Icon className="h-5 w-5 text-primary" aria-hidden />
          <p className="mt-2 font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted">
            {text}
            {title === "Solicitar suporte" && supportContact ? ` Contato: ${supportContact}.` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
