import { GraduationCap } from "lucide-react";
import { useBranding } from "../lib/branding";
import { cx } from "./ui";

/** Logotipo configurável: imagem enviada pelo administrador ou marca nominativa com a cor primária. */
export function Brand({ size = "md", onDark = false, className }: { size?: "sm" | "md" | "lg" | "xl"; onDark?: boolean; className?: string }) {
  const { branding } = useBranding();
  const text = { sm: "text-lg", md: "text-xl", lg: "text-3xl", xl: "text-5xl" }[size];
  const icon = { sm: "h-7 w-7", md: "h-8 w-8", lg: "h-11 w-11", xl: "h-16 w-16" }[size];
  if (branding.logoUrl) {
    const h = { sm: "h-7", md: "h-8", lg: "h-12", xl: "h-20" }[size];
    return <img src={branding.logoUrl} alt={branding.platformName} className={cx(h, "w-auto object-contain", className)} />;
  }
  const [first, ...rest] = branding.platformName.split(" ");
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)} aria-label={branding.platformName}>
      <span className={cx("grid place-items-center rounded-xl bg-primary text-primary-fg", icon)} aria-hidden>
        <GraduationCap className="h-[58%] w-[58%]" />
      </span>
      <span className={cx("font-heading font-extrabold tracking-tight leading-none", text)} aria-hidden>
        <span className={onDark ? "text-white" : "text-fg"}>{first}</span>
        {rest.length > 0 && <span className="text-primary"> {rest.join(" ")}</span>}
      </span>
    </span>
  );
}
