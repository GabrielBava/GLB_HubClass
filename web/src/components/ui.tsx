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

// Botões em pílula, como no simulador: o principal em laranja com texto branco, os demais translúcidos com borda.
const variants: Record<Variant, string> = {
  primary: "bg-btn text-btn-fg hover:bg-btn-hover shadow-soft",
  secondary: "bg-pill-hover text-fg hover:bg-active",
  outline: "border border-border bg-pill text-fg hover:bg-pill-hover",
  ghost: "text-fg hover:bg-pill-hover",
  danger: "bg-danger-btn text-white hover:brightness-110",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm gap-1.5 rounded-full",
  md: "h-10 px-[18px] text-sm gap-2 rounded-full",
  lg: "h-12 px-6 text-base gap-2 rounded-full",
  icon: "h-9 w-9 rounded-full",
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
  "w-full rounded-[10px] border border-border bg-input px-3 text-sm text-fg placeholder:text-muted transition hover:border-btn-hover focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-[var(--ring)] disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cx(fieldBase, "h-10", invalid && "border-danger bg-danger/10", className)} {...props} />;
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
        className={cx(fieldBase, "h-10 pr-11", invalid && "border-danger bg-danger/10", className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted hover:text-fg"
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
    <select className={cx(fieldBase, "h-10 cursor-pointer pr-8", className)} {...props}>
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
      <label htmlFor={htmlFor} className="block text-[13px] text-muted">
        {label}
        {required && <span className="ml-0.5 text-primary" aria-hidden>*</span>}
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
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded accent-[var(--brand)]"
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
        className={cx("relative h-6 w-11 shrink-0 rounded-full border transition", checked ? "border-transparent bg-brand" : "border-border bg-track", disabled && "opacity-50")}
      >
        <span className={cx("absolute top-[1px] h-5 w-5 rounded-full bg-white shadow transition", checked ? "left-[21px]" : "left-[1px]")} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Estrutura
export function Card({ className, children, as: As = "div", ...rest }: { className?: string; children: ReactNode; as?: "div" | "section" | "article" } & Record<string, unknown>) {
  return (
    <As className={cx("lc-card", className)} {...rest}>
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
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border-strong text-icon">
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden />
          </span>
        )}
        <div className="min-w-0 self-center">
          <h2 className="font-heading text-[1.05rem] font-semibold leading-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Título no Modelo Life: caixa alta e fino, com a última palavra em negrito e laranja
 * (ex.: "PAINEL DO **LÍDER**"). Textos que não são string ficam como estão.
 */
export function LifeTitle({ text }: { text: ReactNode }) {
  if (typeof text !== "string") return <>{text}</>;
  const t = text.trim();
  const cut = t.lastIndexOf(" ");
  if (cut < 0) return <span className="acento">{t}</span>;
  return (
    <>
      {t.slice(0, cut)} <span className="acento">{t.slice(cut + 1)}</span>
    </>
  );
}

export function PageHeader({ title, description, actions, eyebrow, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="life-title break-words text-[28px] sm:text-[2.1rem]">
          <LifeTitle text={title} />
        </h1>
        <span className="life-rule mt-3" aria-hidden />
        {description && <p className="mt-3 max-w-3xl text-sm text-muted sm:text-[0.94rem]">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** Seção no estilo das vitrines do simulador: rótulo, título laranja em caixa alta e traço fino. */
export function Section({ title, description, action, children, className, eyebrow }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; eyebrow?: ReactNode }) {
  return (
    <section className={cx("space-y-4", className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
          <h2 className="life-title text-[1.45rem] text-brand sm:text-[1.6rem]">
            <LifeTitle text={title} />
          </h2>
          <span className="life-rule mt-2.5" aria-hidden />
          {description && <p className="mt-2.5 text-sm text-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- Indicadores
type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-pill-hover text-muted border-transparent",
  primary: "bg-active text-primary border-brand/30",
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
      className={cx("w-full overflow-hidden rounded-full bg-track", size === "sm" ? "h-1.5" : "h-2.5", className)}
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
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--track)" strokeWidth={stroke} fill="none" />
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
      <div className="absolute inset-0 grid place-items-center text-center">{children ?? <span className="num text-xl">{Math.round(v)}%</span>}</div>
    </div>
  );
}

const iconTone: Record<Tone, string> = {
  neutral: "text-muted",
  primary: "text-icon",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

/** Indicador (KPI) do simulador: bloco interno arredondado; `highlight` usa o degradê laranja da marca. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "primary",
  highlight,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  highlight?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-1.5 rounded-[22px] border p-[18px] transition hover:-translate-y-0.5 hover:shadow-lift",
        highlight ? "lc-highlight" : "border-border bg-subtle",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cx("text-xs", highlight ? "text-on-brand" : "text-muted")}>{label}</p>
        {Icon && <Icon className={cx("h-[18px] w-[18px] shrink-0", highlight ? "text-on-brand" : iconTone[tone])} strokeWidth={1.7} aria-hidden />}
      </div>
      <p className="num text-[1.85rem] leading-[1.1] tracking-[-0.02em]">{value}</p>
      {hint && <p className={cx("text-xs", highlight ? "text-on-brand" : "text-muted")}>{hint}</p>}
    </div>
  );
}

export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-grid shrink-0 place-items-center rounded-full bg-active font-semibold text-primary", className)}
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
  return <div className={cx("animate-pulse rounded-[14px] bg-track", className)} aria-hidden />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[22px] border border-dashed border-border px-6 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full border border-border-strong text-icon">
        <Icon className="h-5 w-5" strokeWidth={1.7} aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 rounded-[22px] border border-danger/30 bg-danger/5 px-6 py-8 text-center">
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
    <div className={cx("flex gap-3 rounded-[14px] border px-4 py-3 text-sm", tones[tone])} role={tone === "danger" ? "alert" : undefined}>
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
    <div className="fixed inset-0 z-[150] flex items-end justify-center bg-[var(--veil)] p-0 backdrop-blur-[6px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx("lc-card flex max-h-[92vh] w-full flex-col rounded-b-none shadow-float sm:rounded-[22px]", widths[size])}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-soft px-[22px] py-4">
          <div>
            <h2 id={titleId} className="font-heading text-xl font-semibold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <button data-close onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-pill-hover hover:text-fg" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-[22px] py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-border-soft px-[22px] py-3">{footer}</div>}
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
/** Abas segmentadas em pílula (como "Consórcio | Carta Contemplada" no simulador). */
export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx("max-w-full overflow-x-auto scrollbar-thin", className)}>
      <div role="tablist" className="relative inline-flex gap-0.5 rounded-full border border-border bg-pill p-[3px]">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={cx(
              "flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm transition",
              value === t.id ? "bg-brand font-semibold text-on-brand shadow-soft" : "text-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className={cx("rounded-full px-1.5 text-xs", value === t.id ? "bg-on-brand/15" : "bg-pill-hover")}>{t.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-x-auto rounded-[22px] border border-border bg-card shadow-card">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export const th = "px-4 py-3 text-xs font-medium text-muted bg-pill border-b border-border-soft";
export const td = "px-4 py-3 border-b border-border-soft align-middle";

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
