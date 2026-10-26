import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, GraduationCap, ShieldCheck, Users, X } from "lucide-react";
import { useToast } from "../components/toast";
import { cx } from "../components/ui";
import { useAuth } from "../lib/auth";
import { DEMO_NOTICE, demoData, setDemoRole, type DemoRole } from "./mock";

const ROLES: { id: DemoRole; label: string; home: string; icon: typeof Users }[] = [
  { id: "collaborator", label: "Colaborador", home: "/", icon: GraduationCap },
  { id: "leader", label: "Líder", home: "/lider", icon: Users },
  { id: "admin", label: "Administrador", home: "/admin", icon: ShieldCheck },
];

/** Barra fixa do modo demonstração: troca de perfil e aviso de que nada é gravado. */
export function DemoBar() {
  const { me, refresh } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(true);
  const last = useRef(0);
  const data = demoData();

  useEffect(() => {
    const onNotice = (e: Event) => {
      // Evita repetir o aviso a cada clique.
      if (Date.now() - last.current < 4000) return;
      last.current = Date.now();
      toast.info((e as CustomEvent<string>).detail);
    };
    window.addEventListener(DEMO_NOTICE, onNotice);
    return () => window.removeEventListener(DEMO_NOTICE, onNotice);
  }, [toast]);

  const enter = async (r: (typeof ROLES)[number]) => {
    setDemoRole(r.id);
    qc.clear();
    await refresh();
    navigate(r.home, { replace: true });
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[200] flex items-center gap-2 rounded-full border border-white/10 bg-[#111111] px-3 py-2 text-xs font-semibold text-white shadow-xl"
        aria-label="Abrir painel da demonstração"
      >
        <FlaskConical className="h-4 w-4 text-[#ff7a2e]" aria-hidden /> Demonstração
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[200] w-[min(360px,calc(100vw-2rem))] rounded-[22px] border border-white/10 bg-[#111111] p-4 text-white shadow-2xl" role="region" aria-label="Demonstração">
      <div className="flex items-start gap-2">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-[#ff7a2e]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Demonstração sem servidor</p>
          <p className="mt-0.5 text-xs leading-relaxed text-white/65">
            Dados fictícios gravados do sistema real{data ? ` em ${new Date(data.recordedAt).toLocaleDateString("pt-BR")}` : ""}. Navegação e telas são reais; alterações são simuladas e não ficam salvas.
          </p>
        </div>
        <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Minimizar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/50">{me ? "Trocar de perfil" : "Entrar como"}</p>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {ROLES.map((r) => {
          const active = me && data?.roles[r.id].email === me.user.email;
          return (
            <button
              key={r.id}
              onClick={() => void enter(r)}
              className={cx(
                "flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-xs font-medium transition",
                active ? "border-[#f05a00] bg-[#f05a00]/15 text-white" : "border-white/10 text-white/80 hover:bg-white/5",
              )}
              aria-pressed={!!active}
            >
              <r.icon className="h-4 w-4" aria-hidden />
              {r.label}
            </button>
          );
        })}
      </div>
      {data && (
        <p className="mt-2 text-[11px] text-white/45">
          {ROLES.map((r) => `${r.label}: ${data.roles[r.id].name}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
