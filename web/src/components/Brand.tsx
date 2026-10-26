import { useBranding } from "../lib/branding";
import { cx } from "./ui";
import defaultLogoForLight from "../assets/brand/glb-logo-claro.png";
import defaultLogoForDark from "../assets/brand/glb-logo-escuro.png";

const HEIGHTS = { sm: "h-7", md: "h-8", lg: "h-12", xl: "h-16" } as const;

/**
 * Assinatura da plataforma: logotipo da organização (versão para fundo claro ou escuro, configurável
 * pelo administrador; padrão do Grupo Life Brasil) e o nome do produto (ex.: LIFE CLASS) como rótulo.
 * `onDark` indica um contêiner sempre escuro (menu lateral, telas de acesso); fora dele, segue o tema.
 */
export function Brand({
  size = "md",
  onDark = false,
  product = true,
  align = "center",
  variant,
  className,
}: {
  size?: "sm" | "md" | "lg" | "xl";
  onDark?: boolean;
  product?: boolean;
  /** Alinhamento quando o nome do produto fica abaixo do logotipo (tamanhos lg e xl). */
  align?: "center" | "start";
  /** Força a versão do logotipo (prévias na tela de configurações). */
  variant?: "light" | "dark";
  className?: string;
}) {
  const { branding, isDark } = useBranding();
  const dark = variant ? variant === "dark" : onDark || isDark;
  const src = dark ? (branding.logoDarkUrl ?? defaultLogoForDark) : (branding.logoUrl ?? defaultLogoForLight);
  const stacked = size === "lg" || size === "xl";
  return (
    <span className={cx("inline-flex min-w-0", stacked ? cx("flex-col gap-3", align === "start" ? "items-start" : "items-center") : "items-center gap-3", className)}>
      <img src={src} alt={branding.organizationName} className={cx(HEIGHTS[size], "w-auto shrink-0 object-contain")} draggable={false} />
      {product && (
        <span
          className={cx(
            "font-body font-bold uppercase leading-none",
            dark ? "text-brand" : "text-primary",
            stacked ? (size === "xl" ? "text-lg tracking-[0.32em]" : "text-sm tracking-[0.28em]") : "border-l pl-3 text-[11px] tracking-[0.18em]",
            !stacked && (dark ? "border-white/20" : "border-border"),
          )}
        >
          {branding.platformName}
        </span>
      )}
    </span>
  );
}
