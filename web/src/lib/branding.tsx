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
  logoUrl: string | null;
}

export const FALLBACK_BRANDING: Branding = {
  platformName: "LIFE CLASS",
  organizationName: "Grupo Life Brasil",
  tagline: "Universidade corporativa do Grupo Life Brasil. Aprender, praticar e executar.",
  loginMessage: "Acesse seu ambiente de aprendizado e desenvolvimento.",
  colors: { primary: "#1FB873", brandSurface: "#0B1210", accent: "#0E6B4A" },
  fonts: { heading: "Bricolage Grotesque", body: "Inter" },
  defaultMode: "light",
  logoUrl: null,
};

type ThemePref = "light" | "dark" | "system";

interface BrandingContextValue {
  branding: Branding;
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  isDark: boolean;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

/** Escolhe texto claro ou escuro sobre a cor primária, conforme o contraste (WCAG). */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#04140c";
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.36 ? "#04140c" : "#ffffff";
}

export function applyBrandingVars(b: Branding, target: HTMLElement = document.documentElement) {
  target.style.setProperty("--primary", b.colors.primary);
  target.style.setProperty("--primary-fg", readableOn(b.colors.primary));
  target.style.setProperty("--surface", b.colors.brandSurface);
  target.style.setProperty("--accent", b.colors.accent);
  target.style.setProperty("--font-heading", `"${b.fonts.heading}", "${b.fonts.body}", system-ui, sans-serif`);
  target.style.setProperty("--font-body", `"${b.fonts.body}", system-ui, -apple-system, "Segoe UI", sans-serif`);
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
