import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type Tone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((tone: Tone, message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, tone, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  const api = useMemo(() => ({ success: (m: string) => push("success", m), error: (m: string) => push("error", m), info: (m: string) => push("info", m) }), [push]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="no-print fixed bottom-4 right-4 left-4 sm:left-auto z-[200] flex flex-col gap-2 sm:w-96">
        {items.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? AlertTriangle : Info;
          const color = t.tone === "success" ? "text-success" : t.tone === "error" ? "text-danger" : "text-info";
          return (
            <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-lg">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} aria-hidden />
              <p className="flex-1 text-sm">{t.message}</p>
              <button className="text-muted hover:text-fg" aria-label="Fechar aviso" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastProvider ausente");
  return ctx;
}
