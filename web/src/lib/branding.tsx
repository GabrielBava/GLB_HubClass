import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export interface Branding {
  platformName: string;
  organizationName: string;
  tagline: string;
  loginMessage: string;
  colors: { primary: string; brandSurface: string; accent: string };
  fonts: { heading: string; body: string };
  defaultMode: "light" | "dark" | "system";
  /** Logotipo para fundos claros (enviado pelo administrador); sem ele, usa o logotipo padrão. */
  logoUrl: string | null;
  /** Logotipo para fundos escuros (menu lateral e telas de acesso). */
  logoDarkUrl: string | null;
}

export const FALLBACK_BRANDING: Branding = {
  platformName: "LIFE CLASS",
  organizationName: "Grupo Life Brasil",
  tagline: "Universidade corporativa do Grupo Life Brasil. Aprender, praticar e executar.",
  loginMessage: "Acesse seu ambiente de aprendizado e desenvolvimento.",
  colors: { primary: "#F36B22", brandSurface: "#171716", accent: "#FF9C42" },
  fonts: { heading: "Newsreader", body: "DM Sans" },
  defaultMode: "light",
  logoUrl: null,
  logoDarkUrl: null,
};

type ThemePref = "light" | "dark" | "system";

interface BrandingContextValue {
  branding: Branding;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  isDark: boolean;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

const INK = "#171716";
const SERIF_FONTS = new Set(["Newsreader", "Fraunces"]);

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const c = rgb(hex);
  if (!c) return 0;
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Razão de contraste WCAG entre duas cores. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

function mix(hex: string, target: string, amount: number): string {
  const a = rgb(hex)!;
  const b = rgb(target)!;
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** Ajusta a cor em direção a `target` até atingir o contraste mínimo com todos os fundos. */
function untilContrast(hex: string, target: string, backgrounds: string[], min = 4.5): string {
  if (!rgb(hex)) return hex;
  for (let i = 0; i <= 50; i++) {
    const c = mix(hex, target, i * 0.02);
    if (backgrounds.every((bg) => contrastRatio(c, bg) >= min)) return c;
  }
  return target;
}

/** Texto (branco ou carvão) com maior contraste sobre a cor informada. */
export function readableOn(hex: string): string {
  if (!rgb(hex)) return "#ffffff";
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, INK) ? "#ffffff" : INK;
}

export function applyBrandingVars(b: Branding, target: HTMLElement = document.documentElement) {
  const brand = b.colors.primary;
  // Modo claro: laranja escurecido para texto e botões legíveis sobre papel/branco (e texto branco no botão).
  const light = untilContrast(brand, "#000000", ["#ffffff", "#f6f3ed"]);
  // Modo escuro: a cor da marca como está, clareada só se faltar contraste sobre o carvão.
  const dark = untilContrast(brand, "#ffffff", ["#171716", "#201f1e"]);
  target.style.setProperty("--brand", brand);
  target.style.setProperty("--primary-light", light);
  target.style.setProperty("--primary-fg-light", readableOn(light));
  target.style.setProperty("--primary-dark", dark);
  target.style.setProperty("--primary-fg-dark", readableOn(dark));
  target.style.setProperty("--surface", b.colors.brandSurface);
  if (rgb(b.colors.brandSurface)) target.style.setProperty("--surface-2", mix(b.colors.brandSurface, "#ffffff", 0.06));
  target.style.setProperty("--accent", b.colors.accent);
  const fallback = (f: string) => (SERIF_FONTS.has(f) ? `Georgia, "Times New Roman", serif` : `system-ui, -apple-system, "Segoe UI", sans-serif`);
  target.style.setProperty("--font-heading", `"${b.fonts.heading}", ${fallback(b.fonts.heading)}`);
  target.style.setProperty("--font-body", `"${b.fonts.body}", ${fallback(b.fonts.body)}`);
}

function loadFonts(b: Branding) {
  const families = [...new Set([b.fonts.heading, b.fonts.body])]
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700;800`)
    .join("&");
  const href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  let link = document.getElementById("lc-fonts") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = "lc-fonts";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

function readPref(): ThemePref | null {
  try {
    const v = localStorage.getItem("lc-theme");
    return v === "light" || v === "dark" || v === "system" ? v : null;
  } catch {
    return null;
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({ queryKey: ["branding"], queryFn: () => api.get<Branding>("/api/public/branding"), staleTime: 5 * 60_000 });
  const branding = data ?? FALLBACK_BRANDING;
  const [pref, setPref] = useState<ThemePref | null>(readPref);
  const theme = pref ?? branding.defaultMode;
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq?.addEventListener("change", fn);
    return () => mq?.removeEventListener("change", fn);
  }, []);

  const isDark = theme === "dark" || (theme === "system" && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    applyBrandingVars(branding);
    loadFonts(branding);
    document.title = branding.platformName;
    try {
      localStorage.setItem("lc-theme-default", branding.defaultMode);
    } catch {
      /* armazenamento indisponível */
    }
  }, [branding]);

  const setTheme = useCallback((t: ThemePref) => {
    setPref(t);
    try {
      localStorage.setItem("lc-theme", t);
    } catch {
      /* armazenamento indisponível */
    }
  }, []);

  const value = useMemo(() => ({ branding, theme, setTheme, isDark }), [branding, theme, setTheme, isDark]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error("BrandingProvider ausente");
  return ctx;
}
