import { useEffect, useRef, useState } from "react";

/**
 * Dicas ao passar o mouse (ou focar pelo teclado) em botões só com ícone.
 * Vale para qualquer botão ou link com `aria-label` e sem texto visível, ou com `data-tooltip`.
 * A dica é visual: o nome acessível continua sendo o `aria-label`, por isso ela fica `aria-hidden`.
 */
const SELECTOR = "[data-tooltip], button[aria-label], a[aria-label], [role='button'][aria-label]";

function tipFor(el: Element): string | null {
  const explicit = el.getAttribute("data-tooltip");
  if (explicit) return explicit;
  // Só para controles sem texto visível (os que têm texto já se explicam).
  if ((el.textContent ?? "").trim()) return null;
  return el.getAttribute("aria-label");
}

interface Tip {
  text: string;
  x: number;
  y: number;
  below: boolean;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const show = (el: Element, delay: number) => {
      const text = tipFor(el);
      window.clearTimeout(timer.current);
      if (!text) return;
      current.current = el;
      timer.current = window.setTimeout(() => {
        if (current.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 48;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, delay);
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.(SELECTOR);
      if (el && el !== current.current) show(el, 350);
      else if (!el && current.current) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element | null)?.closest?.(SELECTOR);
      if (el && (el as HTMLElement).matches(":focus-visible")) show(el, 0);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer.current);
    };
  }, []);

  if (!tip) return null;
  // Mantém a dica dentro da tela.
  const left = Math.min(Math.max(tip.x, 90), window.innerWidth - 90);
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-[300] max-w-[220px] rounded-[10px] border border-white/10 bg-[#201e1e] px-2.5 py-1.5 text-center text-xs font-medium leading-snug text-[#f7f5f2] shadow-float"
      style={{ left, top: tip.y, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
    >
      {tip.text}
    </div>
  );
}
