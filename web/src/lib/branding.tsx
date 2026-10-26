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
  colors: { primary: "#F05A00", brandSurface: "#000000", accent: "#F7A23A" },
  fonts: { heading: "Titillium Web", body: "Titillium Web" },
  defaultMode: "system",
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

const INK = "#1A0E05";
const SERIF_FONTS = new Set(["Newsreader", "Fraunces"]);
/** Laranja Life: com ele, valem exatamente os tons do simulador. */
const LIFE_ORANGE = "#f05a00";
/** Pesos de cada fonte no Google Fonts (pedir um peso inexistente faz a folha de estilos falhar). */
const FONT_AXES: Record<string, string> = {
  "Titillium Web": "ital,wght@0,300;0,400;0,600;0,700;1,300",
  Lato: "wght@300;400;700;900",
};

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

/**
 * Tons derivados da cor da marca. Com o laranja Life valem exatamente os do simulador;
 * com outra cor, são calculados para manter o contraste.
 */
export function brandTones(brand: string) {
  const life = brand.toLowerCase() === LIFE_ORANGE;
  const btn = life ? "#cc4800" : untilContrast(brand, "#000000", ["#ffffff"], 4.5);
  return {
    // Texto e links: 6:1 sobre branco no claro; clareado sobre os cartões pretos no escuro.
    textLight: life ? "#b03d00" : untilContrast(brand, "#000000", ["#ffffff", "#f7f5f2"], 6),
    textDark: life ? "#ff7a2e" : untilContrast(brand, "#ffffff", ["#111111", "#181818"], 6),
    // Botão principal com texto branco (4,5:1) e ícones (3:1, elemento gráfico).
    btn,
    btnHover: life ? "#b84100" : mix(btn, "#000000", 0.1),
    iconLight: life ? "#e05200" : untilContrast(brand, "#000000", ["#ffffff"], 3),
    iconDark: life ? "#ff7a2e" : untilContrast(brand, "#ffffff", ["#111111"], 3),
    onBrand: readableOn(brand),
  };
}

export function applyBrandingVars(b: Branding, target: HTMLElement = document.documentElement) {
  const brand = b.colors.primary;
  const t = brandTones(brand);
  const set = (k: string, v: string) => target.style.setProperty(k, v);
  set("--brand", brand);
  set("--accent", b.colors.accent);
  set("--primary-light", t.textLight);
  set("--primary-dark", t.textDark);
  set("--btn", t.btn);
  set("--btn-hover", t.btnHover);
  set("--icon-light", t.iconLight);
  set("--icon-dark", t.iconDark);
  set("--on-brand", t.onBrand);
  // Cor institucional: fundo do tema escuro; menu, cartões e campos clareiam a partir dela.
  // Só cores bem escuras servem de fundo escuro; outras mantêm o preto do simulador.
  const surface = rgb(b.colors.brandSurface) && luminance(b.colors.brandSurface) <= 0.03 ? b.colors.brandSurface : "#000000";
  set("--bg-dark", surface);
  set("--sidebar-dark", mix(surface, "#ffffff", 0.043));
  set("--card-dark", mix(surface, "#ffffff", 0.067));
  set("--card-top-dark", mix(surface, "#ffffff", 0.082));
  set("--subtle-dark", mix(surface, "#ffffff", 0.094));
  set("--font-heading", fontStack(b.fonts.heading));
  set("--font-body", fontStack(b.fonts.body));
}

/** A Titillium Web entra depois da Klavika (fonte comercial da marca), como no simulador. */
function fontStack(f: string) {
  if (f === "Titillium Web") return `"Klavika", "Titillium Web", "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  return `"${f}", ${SERIF_FONTS.has(f) ? `Georgia, "Times New Roman", serif` : `system-ui, -apple-system, "Segoe UI", sans-serif`}`;
}

function loadFonts(b: Branding) {
  const families = [...new Set([b.fonts.heading, b.fonts.body])]
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:${FONT_AXES[f] ?? "wght@300;400;500;600;700"}`)
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
