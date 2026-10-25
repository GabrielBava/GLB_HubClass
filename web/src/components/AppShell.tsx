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
  Monitor,
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
  if (role === "admin" || me.canManageContent) {
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
      <div className="px-5 pb-4 pt-5">
        <Link to="/" onClick={onNavigate} aria-label="Ir para o início">
          <Brand size="sm" onDark />
        </Link>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 scrollbar-thin">
        {sections.map((s) => (
          <div key={s.title}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">{s.title}</p>
            <ul className="space-y-0.5">
              {s.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition",
                        isActive ? "bg-white/10 font-medium text-white" : "text-white/65 hover:bg-white/5 hover:text-white",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cx("h-4 w-4 shrink-0", isActive && "text-primary")} aria-hidden />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-3 py-3">
        <NavLink to="/ajuda" onClick={onNavigate} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/65 hover:bg-white/5 hover:text-white">
          <HelpCircle className="h-4 w-4" aria-hidden />
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
      <button aria-haspopup="true" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className="rounded-xl p-2 text-muted hover:bg-subtle hover:text-fg">
        {button(open)}
      </button>
      {open && <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-border bg-card shadow-xl">{children(() => setOpen(false))}</div>}
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
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-fg">{unread > 9 ? "9+" : unread}</span>}
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

function ThemeMenu() {
  const { theme, setTheme, isDark } = useBranding();
  const options = [
    { id: "light" as const, label: "Claro", icon: Sun },
    { id: "dark" as const, label: "Escuro", icon: Moon },
    { id: "system" as const, label: "Igual ao sistema", icon: Monitor },
  ];
  return (
    <Popover label="Tema de cores" button={() => (isDark ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />)}>
      {(close) => (
        <ul className="p-1.5" role="menu">
          {options.map((o) => (
            <li key={o.id}>
              <button
                role="menuitemradio"
                aria-checked={theme === o.id}
                onClick={() => {
                  setTheme(o.id);
                  close();
                }}
                className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-subtle", theme === o.id && "font-medium text-primary")}
              >
                <o.icon className="h-4 w-4" aria-hidden />
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

function UserMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <Popover label="Menu do usuário" button={() => <Avatar name={me.user.name} size={32} />}>
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
              <Link to="/perfil" onClick={close} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-subtle">
                <User className="h-4 w-4" aria-hidden /> Meu perfil e segurança
              </Link>
            </li>
            <li>
              <Link to="/ajuda" onClick={close} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-subtle">
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
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger hover:bg-subtle"
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
      <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-64 bg-surface lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-2xl">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 rounded-lg p-1.5 text-white/70 hover:text-white" aria-label="Fechar menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-xl p-2 text-muted hover:bg-subtle lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Brand size="sm" />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemeMenu />
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
