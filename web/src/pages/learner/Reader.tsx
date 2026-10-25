import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  ExternalLink,
  Highlighter,
  Info,
  ListTree,
  Lock,
  Maximize2,
  MessageSquareText,
  Minimize2,
  NotebookPen,
  PauseCircle,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { estimateReadingMinutes, formatMinutes } from "../../../../shared/reading";
import { Brand } from "../../components/Brand";
import { useToast } from "../../components/toast";
import { Alert, Badge, Button, Card, PageLoader, Progress, Spinner, cx } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useMe } from "../../lib/auth";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { BookmarksPanel, CommentsPanel, NotesPanel, TocPanel } from "./reader/panels";
import { useReadingTracker, type HeartbeatResult } from "./reader/useReadingTracker";

interface ContentResponse {
  preview: boolean;
  content: {
    id: string;
    title: string;
    type: "document" | "video" | "audio" | "link" | "text";
    description: string;
    learningObjective: string;
    ownerName: string;
    isRequired: boolean;
    externalUrl: string | null;
    bodyText: string | null;
    allowTextMode: boolean;
    allowDownload: boolean;
    commentsEnabled: boolean;
  };
  version: { id: string; number: number; pageCount: number; wordCount: number; outline: { title: string; page: number; level: number }[]; processingStatus: string; publishedAt: string | null; changeNotes: string } | null;
  pages: { n: number; w: number; h: number; words: number }[];
  estimate: { minutes: number; wordsPerMinute: number; factor: number };
  progress: { status: string; percent: number; lastPage: number; pagesRead: number[]; activeSeconds: number; viewSeconds: number; versionId: string | null } | null;
  bookmarks: { id: string; page: number; label: string }[];
  track: { id: string; title: string };
  module: { id: string; title: string };
  next: { id: string; title: string } | null;
  assessments: { id: string; title: string }[];
  watermark: { name: string; code: string };
  readingRules: { minPageSeconds: number; idleSeconds: number; completionThreshold: number };
}

type Panel = "toc" | "notes" | "bookmarks" | "comments" | "info" | null;

function watermarkStyle(text: string) {
  const safe = text.replace(/[<>&'"]/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='460' height='240'><text x='20' y='140' transform='rotate(-24 230 120)' fill='rgba(20,30,40,0.09)' font-family='Arial, sans-serif' font-size='15'>${safe}</text></svg>`;
  return { backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")` };
}

/** Página renderizada em <canvas> a partir da imagem com marca d'água gerada no servidor. */
function PageCanvas({ contentId, page, sessionId, width, ratio, onAccessLost }: { contentId: string; page: number; sessionId: string | null; width: number; ratio: number; onAccessLost: (msg: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<number, ImageBitmap>());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      const hit = cache.current.get(p);
      if (hit) return hit;
      const res = await fetch(`/api/contents/${contentId}/pages/${p}/image${sessionId ? `?s=${sessionId}` : ""}`, { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? "Não foi possível carregar a página.");
      }
      const bmp = await createImageBitmap(await res.blob());
      cache.current.set(p, bmp);
      if (cache.current.size > 6) {
        const first = cache.current.keys().next().value as number;
        cache.current.get(first)?.close();
        cache.current.delete(first);
      }
      return bmp;
    },
    [contentId, sessionId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load(page)
      .then((bmp) => {
        if (cancelled || !canvasRef.current) return;
        const c = canvasRef.current;
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")?.drawImage(bmp, 0, 0);
        setLoading(false);
        // Pré-carrega a próxima página para a navegação ficar fluida.
        void load(page + 1).catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onAccessLost(err.message);
        else setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [page, load, onAccessLost]);

  return (
    <div className="relative mx-auto" style={{ width, height: width * ratio }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Página ${page} da apostila. Para leitura com leitor de tela, use o modo texto.`}
        className="protected-page h-full w-full rounded-md bg-white shadow-lg"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      />
      {loading && (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner label="Carregando página..." />
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-danger" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

interface Highlight {
  id: string;
  pageNumber: number;
  quote: string;
  color: string;
}

/** Modo texto (leitura confortável e acessível), com destaques do próprio colaborador. */
function TextPage({ contentId, page, fontScale, highlights, onSelection }: { contentId: string; page: number; fontScale: number; highlights: Highlight[]; onSelection: (text: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["page-text", contentId, page],
    queryFn: () => api.get<{ text: string }>(`/api/contents/${contentId}/pages/${page}/text`),
    staleTime: 5 * 60_000,
  });
  if (isLoading) return <Spinner label="Carregando texto..." />;
  if (error) return <p className="text-sm text-danger">{errorMessage(error)}</p>;
  const text = data?.text ?? "";
  const marks = highlights.filter((h) => h.pageNumber === page);
  const renderPara = (para: string, key: number) => {
    const parts: ReactNode[] = [];
    let rest = para;
    let guard = 0;
    while (rest && guard++ < 50) {
      let best: { idx: number; h: Highlight } | null = null;
      for (const h of marks) {
        const idx = rest.indexOf(h.quote);
        if (idx >= 0 && (!best || idx < best.idx)) best = { idx, h };
      }
      if (!best) {
        parts.push(rest);
        break;
      }
      parts.push(rest.slice(0, best.idx));
      parts.push(
        <mark key={`${key}-${parts.length}`} className="rounded bg-yellow-200/80 px-0.5 text-inherit dark:bg-yellow-500/30">
          {best.h.quote}
        </mark>,
      );
      rest = rest.slice(best.idx + best.h.quote.length);
    }
    return (
      <p key={key} className="mb-4">
        {parts}
      </p>
    );
  };
  return (
    <article
      className="mx-auto max-w-[68ch] leading-[1.75] text-fg"
      style={{ fontSize: `${17 * fontScale}px` }}
      lang="pt-BR"
      onMouseUp={() => {
        const sel = window.getSelection()?.toString().trim() ?? "";
        if (sel.length > 2) onSelection(sel.slice(0, 2000));
      }}
    >
      <p className="mb-6 text-xs uppercase tracking-wider text-muted">Página {page} · modo texto</p>
      {text ? text.split(/\n{2,}|\n(?=\S)/).filter((p) => p.trim()).map(renderPara) : <p className="text-muted">Esta página não possui texto extraível (ex.: imagem ou digitalização).</p>}
    </article>
  );
}

function NonDocument({ data }: { data: ContentResponse }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const done = data.progress?.status === "completed";
  const complete = useAction(() => api.post(`/api/contents/${data.content.id}/complete`), {
    success: "Conteúdo concluído.",
    onSuccess: () => void qc.invalidateQueries(),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <Link to={`/modulos/${data.module.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {data.module.title}
      </Link>
      <Card className="p-6 sm:p-8">
        <p className="text-sm text-muted">{data.track.title}</p>
        <h1 className="mt-1 font-heading text-2xl font-bold">{data.content.title}</h1>
        {data.content.description && <p className="mt-2 text-muted">{data.content.description}</p>}
        {data.content.type === "text" && data.content.bodyText && (
          <div className="mt-6 max-w-[68ch] space-y-4 leading-relaxed">
            {data.content.bodyText.split(/\n{2,}/).map((p, i) => (
              <p key={i} className="whitespace-pre-line">
                {p}
              </p>
            ))}
          </div>
        )}
        {(data.content.type === "video" || data.content.type === "audio") && (
          <Alert tone="info" title="Reprodução integrada prevista para a Fase 2" icon={Info}>
            Por enquanto, o material é acessado pelo link indicado pela área responsável.
          </Alert>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {data.content.externalUrl && (
            <a href={data.content.externalUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" icon={ExternalLink}>
                Abrir conteúdo
              </Button>
            </a>
          )}
          {done ? (
            <Badge tone="success" icon={CheckCircle2}>
              Concluído
            </Badge>
          ) : (
            <Button icon={CheckCircle2} loading={complete.isPending} onClick={() => complete.mutate(undefined)}>
              Marcar como concluído
            </Button>
          )}
          {data.next && (
            <Button variant="ghost" onClick={() => navigate(`/conteudos/${data.next!.id}`)}>
              Próximo: {data.next.title}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

export function ReaderPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error } = useApi<ContentResponse>(`/api/contents/${id}`);
  useDocumentTitle(data?.content.title);

  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<Panel>(() => (window.innerWidth >= 1280 ? "toc" : null));
  const [rightPanel, setRightPanel] = useState<Panel>(params.get("painel") === "comentarios" ? "comments" : null);
  const [zoom, setZoom] = useState(1);
  const [textMode, setTextMode] = useState(false);
  const [quote, setQuote] = useState<string | null>(null);
  const [session, setSession] = useState<{ sessionId: string; watermarkDate: string } | null>(null);
  const [accessLost, setAccessLost] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ percent: number; status: string; pagesRead: number[] } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewport, setViewport] = useState(800);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // Página inicial: ?pagina=, senão a última posição de leitura (retomada).
  useEffect(() => {
    if (!data?.version) return;
    const fromUrl = Number(params.get("pagina"));
    const initial = fromUrl >= 1 ? fromUrl : data.progress?.lastPage ?? 1;
    setPage(Math.min(Math.max(1, initial), Math.max(1, data.version.pageCount)));
    setProgress(data.progress ? { percent: data.progress.percent, status: data.progress.status, pagesRead: data.progress.pagesRead } : { percent: 0, status: "not_started", pagesRead: [] });
  }, [data?.version?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abre a sessão de leitura (registra o acesso e data da marca d'água).
  useEffect(() => {
    if (!data || data.content.type !== "document" || started.current) return;
    started.current = true;
    api
      .post<{ sessionId: string; watermarkDate: string }>(`/api/contents/${id}/sessions`)
      .then(setSession)
      .catch((err) => setAccessLost(errorMessage(err)));
  }, [data, id]);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const logEvent = useCallback((type: string) => void api.post(`/api/contents/${id}/events`, { type }).catch(() => undefined), [id]);

  // Bloqueio de impressão/salvar/cópia pela interface (não impede capturas de tela; a marca d'água garante rastreabilidade).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && (k === "p" || k === "s")) {
        e.preventDefault();
        toast.info(k === "p" ? "A impressão não está disponível para conteúdos protegidos." : "O download do documento não está disponível.");
        logEvent(k === "p" ? "print_attempt" : "save_attempt");
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") setPage((p) => Math.min(p + 1, data?.version?.pageCount ?? p));
      if (e.key === "ArrowLeft" || e.key === "PageUp") setPage((p) => Math.max(1, p - 1));
    };
    const onCopy = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("textarea, input")) return;
      e.preventDefault();
      toast.info("A cópia de trechos do material protegido não é permitida. Use as anotações.");
      logEvent("copy_attempt");
    };
    const onBeforePrint = () => logEvent("print_attempt");
    window.addEventListener("keydown", onKey);
    document.addEventListener("copy", onCopy);
    window.addEventListener("beforeprint", onBeforePrint);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("copy", onCopy);
      window.removeEventListener("beforeprint", onBeforePrint);
    };
  }, [data?.version?.pageCount, logEvent, toast]);

  useEffect(() => {
    if (!data?.version) return;
    const next = new URLSearchParams(params);
    next.set("pagina", String(page));
    next.delete("painel");
    setParams(next, { replace: true });
    mainRef.current?.scrollTo({ top: 0 });
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const initialRead = useMemo(() => data?.progress?.pagesRead ?? [], [data?.progress?.pagesRead]);
  const onUpdate = useCallback((r: HeartbeatResult) => {
    setProgress({ percent: r.percent, status: r.status, pagesRead: r.pagesRead });
    if (r.status === "completed") void qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/tracks") || q.queryKey[0] === "/api/dashboard" });
  }, [qc]);
  const tracker = useReadingTracker({ sessionId: session?.sessionId ?? null, page, rules: data?.readingRules ?? { minPageSeconds: 6, idleSeconds: 120, completionThreshold: 90 }, initialRead, onUpdate });

  const { data: highlights = [] } = useApi<Highlight[]>(data?.content.type === "document" ? `/api/highlights?contentId=${id}` : null);
  const addHighlight = useAction((quoteText: string) => api.post("/api/highlights", { contentId: id, page, quote: quoteText }), {
    invalidate: [`/api/highlights?contentId=${id}`],
    success: "Trecho destacado.",
    onSuccess: () => setQuote(null),
  });
  const [bookmarks, setBookmarks] = useState<{ id: string; page: number; label: string }[]>([]);
  useEffect(() => setBookmarks(data?.bookmarks ?? []), [data?.bookmarks]);
  const bookmarked = bookmarks.find((b) => b.page === page);
  const toggleBookmark = async () => {
    try {
      if (bookmarked) {
        await api.del(`/api/bookmarks/${bookmarked.id}`);
        setBookmarks((bs) => bs.filter((b) => b.id !== bookmarked.id));
      } else {
        const label = data?.version?.outline.filter((o) => o.page <= page).pop()?.title ?? "";
        const b = await api.post<{ id: string; page: number; label: string }>("/api/bookmarks", { contentId: id, page, label });
        setBookmarks((bs) => [...bs, b].sort((a, c) => a.page - c.page));
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (isLoading) return <PageLoader label="Abrindo apostila..." />;
  if (error instanceof ApiError) {
    const terms = error.code === "terms_required";
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Lock className="mx-auto h-10 w-10 text-muted" aria-hidden />
        <h1 className="mt-4 font-heading text-2xl font-bold">{error.status === 404 ? "Conteúdo não encontrado" : error.code === "locked" ? "Conteúdo bloqueado" : "Acesso negado"}</h1>
        <p className="mt-2 text-muted">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>Voltar</Button>
          {terms && <Link to="/primeiro-acesso"><Button>Registrar ciência dos termos</Button></Link>}
        </div>
      </div>
    );
  }
  if (!data) return null;
  if (data.content.type !== "document") return <NonDocument data={data} />;
  if (!data.version || data.version.processingStatus !== "ready") {
    return <div className="p-10 text-center text-muted">Esta apostila ainda está sendo processada. Tente novamente em alguns minutos.</div>;
  }

  const v = data.version;
  const total = v.pageCount;
  const pageMeta = data.pages.find((p) => p.n === page) ?? { w: 1600, h: 2263, words: 0 };
  const ratio = pageMeta.h / pageMeta.w;
  const pageWidth = Math.max(280, Math.min(viewport - 32, 920) * zoom);
  const readSet = new Set(progress?.pagesRead ?? []);
  const unreadWords = data.pages.filter((p) => !readSet.has(p.n)).reduce((s, p) => s + p.words, 0);
  const remaining =
    progress?.status === "completed"
      ? 0
      : v.wordCount > 0
        ? estimateReadingMinutes({ wordCount: unreadWords, pageCount: 0, wordsPerMinute: data.estimate.wordsPerMinute, minutesPerPageFallback: 2, factor: data.estimate.factor })
        : Math.round(data.estimate.minutes * (1 - (progress?.percent ?? 0) / 100));
  const watermark = `${data.watermark.name} · ${data.watermark.code} · ${session?.watermarkDate ?? ""}`;
  const go = (p: number) => {
    setPage(Math.min(Math.max(1, p), total));
    if (window.innerWidth < 1024) {
      setPanel(null);
      setRightPanel(null);
    }
  };

  const toolbarBtn = (active: boolean) => cx("rounded-lg p-2 text-muted hover:bg-subtle hover:text-fg", active && "bg-primary/12 text-primary");

  if (accessLost) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Lock className="mx-auto h-10 w-10 text-muted" aria-hidden />
        <h1 className="mt-4 font-heading text-2xl font-bold">Acesso interrompido</h1>
        <p className="mt-2 text-muted">{accessLost}</p>
        <Link to="/" className="mt-6 inline-block"><Button variant="outline">Voltar ao início</Button></Link>
      </div>
    );
  }

  return (
    <>
      <div ref={rootRef} className="reader-root fixed inset-0 flex flex-col bg-bg">
        <header className="no-print flex h-14 shrink-0 items-center gap-1 border-b border-border bg-card px-2 sm:gap-2 sm:px-3">
          <Link to={`/modulos/${data.module.id}`} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-fg" aria-label={`Voltar para ${data.module.title}`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="hidden md:block">
            <Brand size="sm" />
          </div>
          <div className="min-w-0 flex-1 px-1">
            <p className="truncate text-sm font-semibold">{data.content.title}</p>
            <p className="truncate text-xs text-muted">
              Página {page} de {total} · {progress?.percent ?? 0}% lido{data.preview ? " · pré-visualização" : ""}
            </p>
          </div>
          <button className={toolbarBtn(panel === "toc")} onClick={() => setPanel((p) => (p === "toc" ? null : "toc"))} aria-label="Sumário" aria-pressed={panel === "toc"}>
            <ListTree className="h-5 w-5" />
          </button>
          <button className={toolbarBtn(false)} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))} aria-label="Diminuir zoom">
            <ZoomOut className="h-5 w-5" />
          </button>
          <span className="hidden w-11 text-center text-xs text-muted sm:block" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button className={toolbarBtn(false)} onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))} aria-label="Aumentar zoom">
            <ZoomIn className="h-5 w-5" />
          </button>
          {data.content.allowTextMode && (
            <button className={toolbarBtn(textMode)} onClick={() => setTextMode((t) => !t)} aria-pressed={textMode} aria-label="Modo texto: leitura confortável e acessível" title="Modo texto (leitura confortável e acessível)">
              <Type className="h-5 w-5" />
            </button>
          )}
          <button className={toolbarBtn(!!bookmarked)} onClick={toggleBookmark} aria-pressed={!!bookmarked} aria-label={bookmarked ? "Remover marcador desta página" : "Marcar esta página"}>
            {bookmarked ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}
          </button>
          <button className={toolbarBtn(rightPanel === "notes")} onClick={() => setRightPanel((p) => (p === "notes" ? null : "notes"))} aria-label="Anotações" aria-pressed={rightPanel === "notes"}>
            <NotebookPen className="h-5 w-5" />
          </button>
          {data.content.commentsEnabled && (
            <button className={toolbarBtn(rightPanel === "comments")} onClick={() => setRightPanel((p) => (p === "comments" ? null : "comments"))} aria-label="Dúvidas e comentários" aria-pressed={rightPanel === "comments"}>
              <MessageSquareText className="h-5 w-5" />
            </button>
          )}
          <button className={toolbarBtn(rightPanel === "info")} onClick={() => setRightPanel((p) => (p === "info" ? null : "info"))} aria-label="Informações e tempo de leitura" aria-pressed={rightPanel === "info"}>
            <Info className="h-5 w-5" />
          </button>
          <button
            className={cx(toolbarBtn(fullscreen), "hidden sm:block")}
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : rootRef.current?.requestFullscreen())}
            aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
          >
            {fullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
        </header>
        <div className="no-print h-1 bg-subtle">
          <div className="h-full bg-primary transition-[width]" style={{ width: `${progress?.percent ?? 0}%` }} />
        </div>

        <div className="relative flex min-h-0 flex-1">
          {panel === "toc" && (
            <aside className="no-print absolute inset-y-0 left-0 z-20 w-72 overflow-y-auto border-r border-border bg-card p-3 shadow-xl lg:static lg:shadow-none" aria-label="Sumário da apostila">
              <div className="mb-2 flex items-center justify-between px-2">
                <p className="text-sm font-semibold">Sumário</p>
                <button className="rounded p-1 text-muted hover:text-fg lg:hidden" onClick={() => setPanel(null)} aria-label="Fechar sumário">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <TocPanel outline={v.outline} pages={total} current={page} onGo={go} readPages={readSet} />
              {bookmarks.length > 0 && (
                <>
                  <p className="mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Marcadores</p>
                  <div className="mt-1">
                    <BookmarksPanel
                      bookmarks={bookmarks}
                      onGo={go}
                      onRemove={async (bid) => {
                        await api.del(`/api/bookmarks/${bid}`);
                        setBookmarks((bs) => bs.filter((b) => b.id !== bid));
                      }}
                    />
                  </div>
                </>
              )}
            </aside>
          )}

          <main ref={mainRef} className="min-w-0 flex-1 overflow-auto px-4 py-6" aria-label="Página da apostila">
            {tracker.idle && (
              <p className="no-print mx-auto mb-3 flex max-w-md items-center justify-center gap-2 rounded-full bg-warning/10 px-3 py-1.5 text-xs text-warning" role="status">
                <PauseCircle className="h-4 w-4" aria-hidden /> Leitura pausada por inatividade — o tempo ativo não está sendo contado.
              </p>
            )}
            <div className="relative" onContextMenu={(e) => e.preventDefault()}>
              {textMode ? (
                <Card className="protected-text px-5 py-8 sm:px-10">
                  <TextPage contentId={id} page={page} fontScale={zoom} highlights={highlights} onSelection={(t) => setQuote(t)} />
                </Card>
              ) : (
                <PageCanvas contentId={id} page={page} sessionId={session?.sessionId ?? null} width={pageWidth} ratio={ratio} onAccessLost={setAccessLost} />
              )}
              <div className="watermark-overlay absolute inset-0" style={watermarkStyle(watermark)} aria-hidden />
            </div>
            {quote && (
              <div className="no-print fixed bottom-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-xl">
                <span className="max-w-[200px] truncate text-xs text-muted">“{quote}”</span>
                <Button size="sm" variant="outline" icon={Highlighter} loading={addHighlight.isPending} onClick={() => addHighlight.mutate(quote)}>
                  Destacar
                </Button>
                <Button size="sm" icon={NotebookPen} onClick={() => setRightPanel("notes")}>
                  Anotar
                </Button>
                <button className="rounded p-1 text-muted hover:text-fg" onClick={() => setQuote(null)} aria-label="Cancelar seleção">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {page === total && (
              <Card className="no-print mx-auto mt-6 max-w-xl p-5 text-center">
                <p className="font-heading text-lg font-semibold">Você chegou ao fim da apostila</p>
                <p className="mt-1 text-sm text-muted">
                  {progress?.status === "completed" ? "Leitura concluída." : `Para concluir, leia ao menos ${data.readingRules.completionThreshold}% das páginas com atenção.`}
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {data.assessments.map((a) => (
                    <Link key={a.id} to={`/avaliacoes/${a.id}`}>
                      <Button icon={ClipboardCheck}>Ir para: {a.title}</Button>
                    </Link>
                  ))}
                  {data.next && (
                    <Link to={`/conteudos/${data.next.id}`}>
                      <Button variant="outline">Próximo conteúdo</Button>
                    </Link>
                  )}
                </div>
              </Card>
            )}
          </main>

          {rightPanel && (
            <aside className="no-print absolute inset-y-0 right-0 z-20 w-full max-w-sm overflow-y-auto border-l border-border bg-card p-4 shadow-xl lg:static lg:shadow-none" aria-label="Painel lateral">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-semibold">{rightPanel === "notes" ? "Minhas anotações" : rightPanel === "comments" ? "Dúvidas e comentários" : "Sobre esta apostila"}</p>
                <button className="rounded p-1 text-muted hover:text-fg" onClick={() => setRightPanel(null)} aria-label="Fechar painel">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {rightPanel === "notes" && <NotesPanel contentId={id} page={page} quote={quote} onClearQuote={() => setQuote(null)} onGo={go} commentsEnabled={data.content.commentsEnabled} />}
              {rightPanel === "comments" && <CommentsPanel contentId={id} page={page} onGo={go} />}
              {rightPanel === "info" && (
                <div className="space-y-4 text-sm">
                  <div>
                    <p className="text-muted">{data.track.title}</p>
                    <p className="font-medium">{data.module.title}</p>
                  </div>
                  <ul className="space-y-1.5">
                    <li>{total} páginas{v.wordCount ? ` · ${v.wordCount.toLocaleString("pt-BR")} palavras` : ""}</li>
                    <li>Leitura estimada: {formatMinutes(data.estimate.minutes)} ({data.estimate.wordsPerMinute} palavras/min{data.estimate.factor !== 1 ? `, fator ${data.estimate.factor.toLocaleString("pt-BR")}` : ""})</li>
                    <li>Progresso: {progress?.percent ?? 0}%</li>
                    <li>Tempo restante estimado: {formatMinutes(remaining)}</li>
                  </ul>
                  <Progress value={progress?.percent ?? 0} label="Progresso da leitura" />
                  <div className="rounded-xl bg-subtle p-3 text-xs text-muted">
                    <p>
                      <strong className="text-fg">Tempo de visualização</strong> conta enquanto a página está aberta e visível. <strong className="text-fg">Tempo ativo</strong> conta apenas com interação recente. Uma página é considerada lida após {data.readingRules.minPageSeconds} s de leitura ativa.
                    </p>
                    <p className="mt-2">Tempo ativo acumulado: {formatMinutes(Math.round(((data.progress?.activeSeconds ?? 0) + tracker.activeSeconds) / 60)) || "menos de 1 min"}</p>
                  </div>
                  {data.content.learningObjective && (
                    <div>
                      <p className="font-medium">Objetivo de aprendizagem</p>
                      <p className="text-muted">{data.content.learningObjective}</p>
                    </div>
                  )}
                  <p className="text-xs text-muted">
                    Versão {v.number}
                    {v.changeNotes ? ` — ${v.changeNotes}` : ""}
                    {data.content.ownerName ? ` · Responsável: ${data.content.ownerName}` : ""}
                  </p>
                  {data.content.allowDownload && (
                    <a href={`/api/contents/${id}/download`}>
                      <Button variant="outline" size="sm" icon={Download}>
                        Baixar (autorizado)
                      </Button>
                    </a>
                  )}
                  <p className="rounded-xl border border-border p-3 text-xs text-muted">
                    Conteúdo de uso interno e confidencial. As páginas exibem marca d'água com seu nome e identificador ({me.user.code}). Não fotografe, imprima ou compartilhe.
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>

        <footer className="no-print flex h-14 shrink-0 items-center justify-between gap-2 border-t border-border bg-card px-3">
          <Button variant="outline" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => go(page - 1)}>
            <span className="hidden sm:inline">Anterior</span>
          </Button>
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="goto" className="sr-only">
              Ir para a página
            </label>
            <input
              id="goto"
              type="number"
              min={1}
              max={total}
              value={page}
              onChange={(e) => go(Number(e.target.value) || 1)}
              className="h-9 w-16 rounded-lg border border-border bg-input text-center text-sm"
            />
            <span className="text-muted">de {total}</span>
            <span className="hidden text-xs text-muted md:inline">· restante ~{formatMinutes(remaining) || "0 min"}</span>
          </div>
          <Button variant="outline" size="sm" disabled={page >= total} onClick={() => go(page + 1)} className="flex-row-reverse" icon={ChevronRight}>
            <span className="hidden sm:inline">Próxima</span>
          </Button>
        </footer>
      </div>
      <div className="print-blocked-message p-10 text-center">A impressão de conteúdos protegidos não é permitida.</div>
    </>
  );
}
