import { useCallback, useEffect, useRef, useState } from "react";
import { api, postKeepalive } from "../../../lib/api";

export interface ReadingRules {
  minPageSeconds: number;
  idleSeconds: number;
  completionThreshold: number;
}

export interface HeartbeatResult {
  status: "in_progress" | "completed";
  percent: number;
  pagesRead: number[];
  lastPage: number;
}

const HEARTBEAT_MS = 15_000;

/**
 * Mede o tempo de leitura sem confundir "documento aberto" com "estudo":
 * - tempo de visualização: aba visível;
 * - tempo ativo: aba visível e com interação recente (sem ociosidade);
 * - página lida: ao menos `minPageSeconds` de tempo ativo naquela página.
 * Os incrementos são enviados ao servidor a cada 15 s, que também limita os valores.
 */
export function useReadingTracker(opts: {
  sessionId: string | null;
  page: number;
  rules: ReadingRules;
  initialRead: number[];
  onUpdate: (r: HeartbeatResult) => void;
}) {
  const { sessionId, page, rules } = opts;
  const lastInteraction = useRef(Date.now());
  const active = useRef(0);
  const view = useRef(0);
  const pageActive = useRef(new Map<number, number>());
  const read = useRef(new Set(opts.initialRead));
  const pending = useRef(new Set<number>());
  const pageRef = useRef(page);
  const onUpdate = useRef(opts.onUpdate);
  const sending = useRef(false);
  const [idle, setIdle] = useState(false);
  const [activeSeconds, setActiveSeconds] = useState(0);

  pageRef.current = page;
  onUpdate.current = opts.onUpdate;

  useEffect(() => {
    for (const p of opts.initialRead) read.current.add(p);
  }, [opts.initialRead]);

  useEffect(() => {
    const touch = () => {
      lastInteraction.current = Date.now();
    };
    const events = ["mousemove", "keydown", "wheel", "touchstart", "scroll", "pointerdown"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
    };
  }, []);

  // Uma interação "vale" ao trocar de página.
  useEffect(() => {
    lastInteraction.current = Date.now();
  }, [page]);

  const flush = useCallback(
    async (mode: "normal" | "keepalive" | "end" = "normal") => {
      if (!sessionId || (sending.current && mode === "normal")) return;
      const ended = mode === "end";
      const body = {
        page: pageRef.current,
        activeSeconds: Math.round(active.current),
        viewSeconds: Math.round(view.current),
        pagesRead: [...pending.current].slice(0, 50),
        ended,
      };
      if (mode !== "normal") {
        if (body.activeSeconds > 0 || body.viewSeconds > 0 || body.pagesRead.length || ended) {
          postKeepalive(`/api/reading-sessions/${sessionId}/heartbeat`, body);
          active.current -= body.activeSeconds;
          view.current -= body.viewSeconds;
          pending.current.clear();
        }
        return;
      }
      sending.current = true;
      try {
        const r = await api.post<HeartbeatResult>(`/api/reading-sessions/${sessionId}/heartbeat`, body);
        active.current -= body.activeSeconds;
        view.current -= body.viewSeconds;
        for (const p of body.pagesRead) pending.current.delete(p);
        for (const p of r.pagesRead) read.current.add(p);
        onUpdate.current(r);
      } catch {
        // Falha de rede: os acumulados permanecem e serão enviados no próximo pulso.
      } finally {
        sending.current = false;
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (!sessionId) return;
    let last = Date.now();
    let lastSent = Date.now();
    const tick = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(5, (now - last) / 1000);
      last = now;
      if (document.visibilityState !== "visible") return;
      view.current += dt;
      const isIdle = now - lastInteraction.current > rules.idleSeconds * 1000;
      setIdle(isIdle);
      if (!isIdle) {
        active.current += dt;
        setActiveSeconds((s) => s + dt);
        const p = pageRef.current;
        const acc = (pageActive.current.get(p) ?? 0) + dt;
        pageActive.current.set(p, acc);
        if (acc >= rules.minPageSeconds && !read.current.has(p)) {
          read.current.add(p);
          pending.current.add(p);
        }
      }
      if (now - lastSent >= HEARTBEAT_MS || (pending.current.size > 0 && now - lastSent >= 5000)) {
        lastSent = now;
        void flush();
      }
    }, 1000);
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => void flush("end");
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      // Ao sair do leitor dentro da aplicação, envia o que falta (a sessão encerra por inatividade).
      void flush("keepalive");
    };
  }, [sessionId, rules.idleSeconds, rules.minPageSeconds, flush]);

  return { idle, activeSeconds, readPages: read.current };
}
