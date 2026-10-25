import { useState } from "react";
import { Bookmark, MessageCircleQuestion, NotebookPen, Reply, Send, Trash2 } from "lucide-react";
import { ROLE_LABEL, type Role } from "../../../../../shared/domain";
import { Badge, Button, EmptyState, Spinner, Textarea, cx } from "../../../components/ui";
import { api } from "../../../lib/api";
import { relativeTime } from "../../../lib/format";
import { useAction, useApi } from "../../../lib/hooks";

export interface Note {
  id: string;
  page: number | null;
  quote: string | null;
  body: string;
  kind: "note" | "doubt";
  createdAt: string;
}

export function TocPanel({ outline, pages, current, onGo, readPages }: { outline: { title: string; page: number; level: number }[]; pages: number; current: number; onGo: (p: number) => void; readPages: Set<number> }) {
  return (
    <nav aria-label="Sumário">
      <ul className="space-y-0.5">
        {outline.map((o, i) => (
          <li key={i}>
            <button
              onClick={() => onGo(o.page)}
              className={cx(
                "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-subtle",
                o.page === current && "bg-primary/10 font-medium text-primary",
              )}
              style={{ paddingLeft: 8 + o.level * 14 }}
            >
              <span className="min-w-0 flex-1">{o.title}</span>
              <span className="shrink-0 text-xs text-muted">{o.page}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Páginas</p>
      <div className="mt-2 grid grid-cols-6 gap-1 px-1">
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            onClick={() => onGo(p)}
            aria-label={`Ir para a página ${p}${readPages.has(p) ? " (lida)" : ""}`}
            aria-current={p === current ? "page" : undefined}
            className={cx(
              "h-8 rounded-md text-xs",
              p === current ? "bg-primary text-primary-fg" : readPages.has(p) ? "bg-success/15 text-success" : "bg-subtle text-muted hover:text-fg",
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function NotesPanel({ contentId, page, quote, onClearQuote, onGo, commentsEnabled }: { contentId: string; page: number; quote: string | null; onClearQuote: () => void; onGo: (p: number) => void; commentsEnabled: boolean }) {
  const url = `/api/notes?contentId=${contentId}`;
  const { data, isLoading } = useApi<Note[]>(url);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"note" | "doubt">("note");
  const create = useAction(() => api.post("/api/notes", { contentId, page, quote, body, kind }), {
    invalidate: [url, "/api/notes"],
    success: kind === "doubt" ? "Dúvida registrada (privada)." : "Anotação salva.",
    onSuccess: () => {
      setBody("");
      onClearQuote();
    },
  });
  const remove = useAction((id: string) => api.del(`/api/notes/${id}`), { invalidate: [url], success: "Anotação excluída." });
  const publish = useAction((n: Note) => api.post(`/api/contents/${contentId}/comments`, { body: n.body, page: n.page }), {
    invalidate: [`/api/contents/${contentId}/comments`],
    success: "Dúvida publicada no espaço de comentários.",
  });
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex gap-1" role="radiogroup" aria-label="Tipo">
          {(["note", "doubt"] as const).map((k) => (
            <button key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cx("rounded-lg px-2.5 py-1 text-xs font-medium", kind === k ? "bg-primary/15 text-primary" : "text-muted hover:bg-subtle")}>
              {k === "note" ? "Anotação" : "Minha dúvida"}
            </button>
          ))}
          <span className="ml-auto self-center text-xs text-muted">Página {page}</span>
        </div>
        {quote && (
          <blockquote className="flex items-start gap-2 border-l-2 border-primary pl-2 text-xs text-muted">
            <span className="line-clamp-3 flex-1">“{quote}”</span>
            <button onClick={onClearQuote} className="text-muted hover:text-fg" aria-label="Remover trecho">×</button>
          </blockquote>
        )}
        <Textarea aria-label="Texto da anotação" value={body} onChange={(e) => setBody(e.target.value)} placeholder={kind === "note" ? "O que você aprendeu nesta página?" : "Qual é a sua dúvida?"} className="min-h-[80px]" maxLength={10000} />
        <Button size="sm" icon={NotebookPen} disabled={!body.trim()} loading={create.isPending} onClick={() => create.mutate(undefined)} className="w-full">
          Salvar
        </Button>
        <p className="text-[11px] text-muted">Anotações e dúvidas são privadas. Para perguntar ao líder e colegas, publique a dúvida explicitamente.</p>
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.length ? (
        <p className="text-sm text-muted">Nenhuma anotação nesta apostila.</p>
      ) : (
        <ul className="space-y-2">
          {data.map((n) => (
            <li key={n.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="mb-1 flex items-center gap-2">
                {n.kind === "doubt" && <Badge tone="warning">Dúvida</Badge>}
                {n.page && (
                  <button className="text-xs text-primary hover:underline" onClick={() => onGo(n.page!)}>
                    p. {n.page}
                  </button>
                )}
                <span className="ml-auto text-[11px] text-muted">{relativeTime(n.createdAt)}</span>
              </div>
              {n.quote && <blockquote className="mb-1 border-l-2 border-border pl-2 text-xs text-muted">“{n.quote}”</blockquote>}
              <p className="whitespace-pre-line">{n.body}</p>
              <div className="mt-2 flex gap-1">
                {n.kind === "doubt" && commentsEnabled && (
                  <Button size="sm" variant="ghost" icon={Send} onClick={() => publish.mutate(n)}>
                    Publicar dúvida
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove.mutate(n.id)} aria-label="Excluir anotação" className="ml-auto text-danger" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BookmarksPanel({ bookmarks, onGo, onRemove }: { bookmarks: { id: string; page: number; label: string }[]; onGo: (p: number) => void; onRemove: (id: string) => void }) {
  if (!bookmarks.length) return <EmptyState icon={Bookmark} title="Sem marcadores" description="Use o botão de marcador na barra superior para guardar páginas importantes." />;
  return (
    <ul className="space-y-1">
      {bookmarks.map((b) => (
        <li key={b.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-subtle">
          <button onClick={() => onGo(b.page)} className="flex-1 text-left text-sm">
            <span className="font-medium">Página {b.page}</span>
            {b.label && <span className="block text-xs text-muted">{b.label}</span>}
          </button>
          <button onClick={() => onRemove(b.id)} className="rounded p-1 text-muted hover:text-danger" aria-label={`Remover marcador da página ${b.page}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

interface Thread {
  id: string;
  page: number | null;
  body: string;
  isHidden: boolean;
  author: { name: string; role: Role };
  isMine: boolean;
  createdAt: string;
  replies: Omit<Thread, "replies">[];
}

export function CommentsPanel({ contentId, page, onGo }: { contentId: string; page: number; onGo: (p: number) => void }) {
  const url = `/api/contents/${contentId}/comments`;
  const { data, isLoading } = useApi<{ canModerate: boolean; threads: Thread[] }>(url);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const post = useAction((v: { body: string; parentId?: string; page?: number }) => api.post(url, v), {
    invalidate: [url],
    success: "Publicado.",
    onSuccess: () => {
      setBody("");
      setReply("");
      setReplyTo(null);
    },
  });
  const hide = useAction((id: string) => api.del(`/api/comments/${id}`), { invalidate: [url] });
  const Item = ({ c, isReply }: { c: Omit<Thread, "replies">; isReply?: boolean }) => (
    <div className={cx("text-sm", isReply && "ml-4 border-l-2 border-border pl-3")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{c.author.name}</span>
        {c.author.role !== "collaborator" && <Badge tone="primary">{ROLE_LABEL[c.author.role]}</Badge>}
        {c.page && (
          <button className="text-xs text-primary hover:underline" onClick={() => onGo(c.page!)}>
            p. {c.page}
          </button>
        )}
        <span className="ml-auto text-[11px] text-muted">{relativeTime(c.createdAt)}</span>
      </div>
      <p className={cx("mt-1 whitespace-pre-line", c.isHidden && "italic text-muted")}>{c.isHidden ? "Comentário oculto pela moderação." : c.body}</p>
      {(c.isMine || data?.canModerate) && !c.isHidden && (
        <button className="mt-1 text-xs text-muted hover:text-danger" onClick={() => hide.mutate(c.id)}>
          {c.isMine ? "Excluir" : "Ocultar"}
        </button>
      )}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-xl border border-border p-3">
        <Textarea aria-label="Nova dúvida ou comentário" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Pergunte ao líder e aos colegas desta trilha (visível para quem tem acesso)." className="min-h-[72px]" maxLength={5000} />
        <Button size="sm" icon={MessageCircleQuestion} className="w-full" disabled={!body.trim()} loading={post.isPending && !replyTo} onClick={() => post.mutate({ body, page })}>
          Publicar na página {page}
        </Button>
      </div>
      {isLoading ? (
        <Spinner />
      ) : !data?.threads.length ? (
        <p className="text-sm text-muted">Nenhuma dúvida publicada ainda.</p>
      ) : (
        <ul className="space-y-4">
          {data.threads.map((t) => (
            <li key={t.id} className="space-y-2 rounded-xl border border-border p-3">
              <Item c={t} />
              {t.replies.map((r) => (
                <Item key={r.id} c={r} isReply />
              ))}
              {replyTo === t.id ? (
                <div className="space-y-2">
                  <Textarea aria-label="Resposta" value={reply} onChange={(e) => setReply(e.target.value)} className="min-h-[60px]" />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!reply.trim()} loading={post.isPending} onClick={() => post.mutate({ body: reply, parentId: t.id })}>
                      Responder
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <button className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setReplyTo(t.id)}>
                  <Reply className="h-3.5 w-3.5" aria-hidden /> Responder
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
