import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertTriangle, Eye, EyeOff, Inbox, Loader2, X, type LucideIcon } from "lucide-react";
import { errorMessage } from "../lib/api";
import { initials } from "../lib/format";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Botões
type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg hover:brightness-110 active:brightness-95 shadow-sm",
  secondary: "bg-subtle text-fg hover:bg-border/70",
  outline: "border border-border bg-card text-fg hover:bg-subtle",
  ghost: "text-fg hover:bg-subtle",
  danger: "bg-danger text-white hover:brightness-110",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-base gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
  glow?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, glow, className, children, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center font-medium transition disabled:cursor-not-allowed disabled:opacity-55 whitespace-nowrap",
        variants[variant],
        sizes[size],
        glow && "brand-glow",
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Campos
const fieldBase =
  "w-full rounded-xl border border-border bg-input px-3.5 text-sm text-fg placeholder:text-muted/80 transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx(fieldBase, "h-11", invalid && "border-danger", className)} {...props} />;
});

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function PasswordInput(
  { className, invalid, ...props },
  ref,
) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={show ? "text" : "password"}
        aria-invalid={invalid || undefined}
        className={cx(fieldBase, "h-11 pr-11", invalid && "border-danger", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted hover:text-fg"
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={show}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx(fieldBase, "min-h-[96px] py-2.5 leading-relaxed", className)} {...props} />;
});

export function Select({
  options,
  placeholder,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select className={cx(fieldBase, "h-11 pr-8", className)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
  htmlFor,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, description, checked, onChange, disabled }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-[var(--primary)]"
      />
      <label htmlFor={id} className="text-sm leading-snug">
        <span className="font-medium">{label}</span>
        {description && <span className="block text-xs text-muted mt-0.5">{description}</span>}
      </label>
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {description && <span className="block text-xs text-muted mt-0.5">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-primary" : "bg-border", disabled && "opacity-50")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Estrutura
export function Card({ className, children, as: As = "div", ...rest }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" } & Record<string, unknown>) {
  return (
    <As className={cx("rounded-xl border border-border bg-card", className)} {...rest}>
      {children}
    </As>
  );
}

/** Cabeçalho de cartão. `flush` remove o espaçamento próprio (cartões que já têm padding). */
export function CardHeader({ title, description, action, icon: Icon, flush }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: LucideIcon; flush?: boolean }) {
  return (
    <div className={cx("flex items-start justify-between gap-3", !flush && "px-5 pt-5")}>
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1.5">{eyebrow}</div>}
        <h1 className="font-heading text-[28px] font-medium leading-tight sm:text-[34px]">{title}</h1>
        {/* Traço curto em laranja sob o título (guia de identidade: "título que diz a ideia"). */}
        <span className="mt-2.5 block h-[3px] w-12 rounded-full bg-brand" aria-hidden />
        {description && <p className="mt-1.5 max-w-3xl text-sm text-muted sm:text-base">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Section({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("space-y-3", className)}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- Indicadores
type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-subtle text-muted border-border",
  primary: "bg-primary/12 text-primary border-primary/25",
  success: "bg-success/10 text-success border-success/25",
  warning: "bg-warning/10 text-warning border-warning/25",
  danger: "bg-danger/10 text-danger border-danger/25",
  info: "bg-info/10 text-info border-info/25",
};

export function Badge({ tone = "neutral", children, icon: Icon, className }: { tone?: Tone; children: ReactNode; icon?: LucideIcon; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {children}
    </span>
  );
}

export function Progress({ value, label, className, size = "md" }: { value: number; label?: string; className?: string; size?: "sm" | "md" }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-label={label ?? "Progresso"}
      className={cx("w-full overflow-hidden rounded-full bg-subtle", size === "sm" ? "h-1.5" : "h-2.5", className)}
    >
      <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}

export function ProgressRing({ value, size = 88, stroke = 9, label, children }: { value: number; size?: number; stroke?: number; label?: string; children?: ReactNode }) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={label ?? `${Math.round(v)}% concluído`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--subtle)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--brand)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          style={{ transition: "stroke-dashoffset .6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children ?? <span className="font-heading text-xl font-bold">{Math.round(v)}%</span>}</div>
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = "primary" }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: Tone }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {Icon && (
          <span className={cx("grid h-8 w-8 place-items-center rounded-lg border", tones[tone])}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-2 font-heading text-2xl font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-grid shrink-0 place-items-center rounded-full bg-primary/15 font-semibold text-primary", className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------- Estados
export function Spinner({ label = "Carregando..." }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-muted">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

export function PageLoader({ label }: { label?: string }) {
  return (
    <div className="grid min-h-[40vh] place-items-center" aria-busy="true">
      <Spinner label={label} />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-xl bg-subtle", className)} aria-hidden />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-subtle text-muted">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-2xl border border-danger/30 bg-danger/5 px-6 py-8 text-center">
      <AlertTriangle className="h-6 w-6 text-danger" aria-hidden />
      <p className="font-medium">Não foi possível carregar</p>
      <p className="text-sm text-muted">{errorMessage(error)}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = "info", title, children, icon: Icon }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className={cx("flex gap-3 rounded-xl border px-4 py-3 text-sm", tones[tone])} role={tone === "danger" ? "alert" : undefined}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div className="text-fg">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx(title ? "mt-0.5" : "", "text-muted")}>{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])");
      (el ?? ref.current)?.focus();
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx("flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl", widths[size])}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="font-heading text-lg font-semibold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button data-close onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-fg" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmButton({
  children,
  title,
  message,
  confirmLabel = "Confirmar",
  onConfirm,
  variant = "outline",
  confirmVariant = "danger",
  size = "sm",
  icon,
  loading,
}: {
  children: ReactNode;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void | Promise<unknown>;
  variant?: Variant;
  confirmVariant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} icon={icon} onClick={() => setOpen(true)} loading={loading}>
        {children}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant={confirmVariant}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        <div className="text-sm text-muted">{message}</div>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------- Abas e tabelas
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={cx("flex gap-1 overflow-x-auto border-b border-border scrollbar-thin", className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition",
            value === t.id ? "border-primary text-fg" : "border-transparent text-muted hover:text-fg",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-subtle px-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export const th = "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted bg-subtle/60 border-b border-border";
export const td = "px-4 py-3 border-b border-border/70 align-middle";

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
