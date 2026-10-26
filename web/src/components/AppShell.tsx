import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import {
  Bell,
  BookMarked,
  BookOpen,
  Building,
  ChartColumn,
  ClipboardCheck,
  FileQuestion,
  FolderTree,
  GraduationCap,
  HelpCircle,
  Home,
  Inbox,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  NotebookPen,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Sun,
  TrendingUp,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { ROLE_LABEL } from "../../../shared/domain";
import { api } from "../lib/api";
import { useAuth, useMe } from "../lib/auth";
import { useBranding } from "../lib/branding";
import { relativeTime } from "../lib/format";
import { useApi } from "../lib/hooks";
import { Brand } from "./Brand";
import { Avatar, cx } from "./ui";
import { useQueryClient } from "@tanstack/react-query";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

function useNavSections() {
  const me = useMe();
  const role = me.user.role;
  const sections: { title: string; items: NavItem[] }[] = [
    {
      title: "Aprender",
      items: [
        { to: "/", label: "Início", icon: Home, end: true },
        { to: "/areas", label: "Áreas de conhecimento", icon: GraduationCap },
        { to: "/trilhas", label: "Catálogo de trilhas", icon: BookOpen },
        { to: "/anotacoes", label: "Minhas anotações", icon: NotebookPen },
        { to: "/minha-evolucao", label: "Minha evolução", icon: TrendingUp },
        { to: "/biblioteca", label: "Biblioteca", icon: Library },
      ],
    },
  ];
  if (role === "leader" || role === "admin") {
    sections.push({
      title: "Liderança",
      items: [
        { to: "/lider", label: "Painel do líder", icon: LayoutDashboard, end: true },
        { to: "/lider/validacoes", label: "Validações", icon: ClipboardCheck },
        { to: "/lider/duvidas", label: "Dúvidas das trilhas", icon: MessagesSquare },
        { to: "/lider/solicitacoes", label: "Solicitações", icon: Inbox },
      ],
    });
  }
  if (role === "admin") {
    sections.push({
      title: "Conteúdo",
      items: [
        { to: "/admin/conteudos", label: "Áreas e trilhas", icon: FolderTree },
        { to: "/admin/questoes", label: "Banco de questões", icon: FileQuestion },
      ],
    });
  }
  if (role === "admin") {
    sections.push({
      title: "Administração",
      items: [
        { to: "/admin", label: "Painel administrativo", icon: ChartColumn, end: true },
        { to: "/admin/usuarios", label: "Usuários e convites", icon: Users },
        { to: "/admin/organizacao", label: "Organização", icon: Building },
        { to: "/admin/permissoes", label: "Permissões", icon: ShieldCheck },
        { to: "/admin/relatorios", label: "Relatórios", icon: TrendingUp },
        { to: "/admin/auditoria", label: "Auditoria", icon: ScrollText },
        { to: "/admin/seguranca", label: "Segurança", icon: Shield },
        { to: "/admin/biblioteca", label: "Gestão da biblioteca", icon: BookMarked },
        { to: "/admin/configuracoes", label: "Configurações", icon: Settings },
      ],
    });
  }
  return sections;
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const sections = useNavSections();
  return (
    <nav aria-label="Navegação principal" className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-6">
        <Link to="/" onClick={onNavigate} aria-label="Ir para o início" className="block">
          <Brand size="sm" />
        </Link>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 scrollbar-thin">
        {sections.map((s) => (
          <div key={s.title}>
            <p className="eyebrow px-3 pb-1.5 text-[11px]">{s.title}</p>
            <ul className="space-y-0.5">
              {s.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        "flex items-center gap-3 rounded-[12px] px-3 py-2 text-sm transition",
                        // Item ativo com o realce laranja do simulador; ícones em laranja, como na apresentação.
                        isActive ? "bg-active font-semibold text-fg" : "text-muted hover:bg-pill-hover hover:text-fg",
                      )
                    }
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0 text-icon" strokeWidth={1.7} aria-hidden />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border-soft px-3 py-3">
        <NavLink to="/ajuda" onClick={onNavigate} className="flex items-center gap-3 rounded-[12px] px-3 py-2 text-sm text-muted hover:bg-pill-hover hover:text-fg">
          <HelpCircle className="h-[18px] w-[18px] text-icon" strokeWidth={1.7} aria-hidden />
          Ajuda e suporte
        </NavLink>
      </div>
    </nav>
  );
}

function Popover({ button, children, label }: { button: (open: boolean) => ReactNode; children: (close: () => void) => ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        data-tooltip={label}
        onClick={() => setOpen((o) => !o)}
        className={cx("grid h-9 min-w-9 place-items-center rounded-full border border-border bg-pill text-muted transition hover:bg-pill-hover hover:text-fg", open && "bg-pill-hover text-fg")}
      >
        {button(open)}
      </button>
      {open && <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[22px] border border-border bg-card shadow-float">{children(() => setOpen(false))}</div>}
    </div>
  );
}

interface NotificationList {
  unread: number;
  items: { id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string }[];
}

function NotificationsBell() {
  const { data } = useApi<NotificationList>("/api/notifications", { refetchInterval: 60_000 });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const unread = data?.unread ?? 0;
  return (
    <Popover
      label={`Notificações${unread ? ` (${unread} não lidas)` : ""}`}
      button={() => (
        <span className="relative block">
          <Bell className="h-[18px] w-[18px]" strokeWidth={1.7} />
          {unread > 0 && <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-on-brand">{unread > 9 ? "9+" : unread}</span>}
        </span>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <p className="font-medium">Notificações</p>
            {unread > 0 && (
              <button
                className="text-xs text-primary hover:underline"
                onClick={async () => {
                  await api.post("/api/notifications/read-all");
                  await qc.invalidateQueries({ queryKey: ["/api/notifications"] });
                }}
              >
                Marcar todas como lidas
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(data?.items ?? []).slice(0, 8).map((n) => (
              <li key={n.id}>
                <button
                  className={cx("w-full px-4 py-3 text-left hover:bg-subtle", !n.readAt && "bg-primary/5")}
                  onClick={async () => {
                    close();
                    if (!n.readAt) {
                      await api.post(`/api/notifications/${n.id}/read`);
                      void qc.invalidateQueries({ queryKey: ["/api/notifications"] });
                    }
                    if (n.link) navigate(n.link);
                  }}
                >
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="line-clamp-2 text-xs text-muted">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-muted">{relativeTime(n.createdAt)}</p>
                </button>
              </li>
            ))}
            {!data?.items.length && <li className="px-4 py-6 text-center text-sm text-muted">Nenhuma notificação por enquanto.</li>}
          </ul>
          <Link to="/notificacoes" onClick={close} className="block border-t border-border px-4 py-2.5 text-center text-sm text-primary hover:bg-subtle">
            Ver todas
          </Link>
        </div>
      )}
    </Popover>
  );
}

/** Tema em pílulas "Claro | Escuro", como no simulador. Sem escolha, vale o padrão da plataforma. */
function ThemeToggle() {
  const { setTheme, isDark } = useBranding();
  const options = [
    { id: "light" as const, label: "Claro", icon: Sun, active: !isDark },
    { id: "dark" as const, label: "Escuro", icon: Moon, active: isDark },
  ];
  return (
    <div className="inline-grid grid-cols-2 gap-0.5 rounded-full border border-border bg-pill p-[3px]" role="group" aria-label="Tema de cores">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.active}
          onClick={() => setTheme(o.id)}
          className={cx(
            "flex h-[30px] items-center justify-center gap-1.5 rounded-full px-3 text-xs transition",
            o.active ? "bg-brand font-semibold text-on-brand shadow-soft" : "text-muted hover:text-fg",
          )}
        >
          <o.icon className="h-3.5 w-3.5" aria-hidden />
          <span className="max-sm:sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function UserMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Popover label="Menu do usuário" button={() => <Avatar name={me.user.name} size={34} className="-m-px" />}>
      {(close) => (
        <div>
          <div className="border-b border-border px-4 py-3">
            <p className="truncate font-medium">{me.user.name}</p>
            <p className="truncate text-xs text-muted">{me.user.email}</p>
            <p className="mt-1 text-xs text-muted">
              {ROLE_LABEL[me.user.role]} · {me.user.code}
            </p>
          </div>
          <ul className="p-1.5">
            <li>
              <Link to="/perfil" onClick={close} className="flex items-center gap-2 rounded-[12px] px-3 py-2 text-sm hover:bg-pill-hover">
                <User className="h-4 w-4" aria-hidden /> Meu perfil e segurança
              </Link>
            </li>
            <li>
              <Link to="/ajuda" onClick={close} className="flex items-center gap-2 rounded-[12px] px-3 py-2 text-sm hover:bg-pill-hover">
                <HelpCircle className="h-4 w-4" aria-hidden /> Ajuda
              </Link>
            </li>
            <li>
              <button
                onClick={async () => {
                  close();
                  await logout();
                  navigate("/entrar", { replace: true });
                }}
                className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-sm text-danger hover:bg-pill-hover"
              >
                <LogOut className="h-4 w-4" aria-hidden /> Sair
              </button>
            </li>
          </ul>
        </div>
      )}
    </Popover>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setMobileOpen(false);
    document.getElementById("conteudo")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <a href="#conteudo" className="skip-link rounded-lg bg-primary px-3 py-2 text-primary-fg">
        Pular para o conteúdo
      </a>
      {/* Menu flutuante à esquerda, como o painel do simulador. */}
      <aside className="no-print fixed bottom-4 left-4 top-4 z-40 hidden w-64 overflow-hidden rounded-[24px] border border-border bg-sidebar shadow-card lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-[var(--veil)] backdrop-blur-[6px]" onClick={() => setMobileOpen(false)} />
          <aside className="absolute bottom-3 left-3 top-3 w-72 max-w-[85vw] overflow-hidden rounded-[24px] border border-border bg-sidebar shadow-float">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-full p-1.5 text-muted hover:bg-pill-hover hover:text-fg" aria-label="Fechar menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-[288px]">
        {/* Barra do topo: fixa só no celular; no computador rola com a página, como no simulador (sem cortar a luz do fundo). */}
        <header className="no-print relative z-30 flex h-16 items-center gap-2 px-4 max-lg:sticky max-lg:top-0 max-lg:bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] max-lg:backdrop-blur-md sm:px-6 lg:pr-8">
          <button className="grid h-9 w-9 place-items-center rounded-full border border-border bg-pill text-muted hover:bg-pill-hover hover:text-fg lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu className="h-[18px] w-[18px]" />
          </button>
          <div className="min-w-0 lg:hidden">
            <Brand size="sm" product={false} />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <NotificationsBell />
            <UserMenu />
          </div>
        </header>
        <main id="conteudo" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
