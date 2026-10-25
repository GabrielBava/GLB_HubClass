import { useState } from "react";
import { Link } from "react-router";
import { Bookmark, Download, NotebookPen, Pencil, Search, Trash2 } from "lucide-react";
import { Badge, Button, Card, ConfirmButton, EmptyState, ErrorState, Input, PageHeader, PageLoader, Tabs, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { useAction, useApi, useDebounced, useDocumentTitle } from "../../lib/hooks";

interface NoteItem {
  id: string;
  contentId: string;
  contentTitle: string;
  moduleTitle: string;
  trackTitle: string;
  page: number | null;
  quote: string | null;
  body: string;
  kind: "note" | "doubt";
  updatedAt: string;
}
interface BookmarkItem {
  id: string;
  contentId: string;
  page: number;
  label: string;
  contentTitle: string;
}

export function NotesPage() {
  const [tab, setTab] = useState<"all" | "note" | "doubt" | "bookmarks">("all");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  useDocumentTitle("Minhas anotações");
  const params = new URLSearchParams();
  if (dq) params.set("q", dq);
  if (tab === "note" || tab === "doubt") params.set("kind", tab);
  const notes = useApi<NoteItem[]>(tab === "bookmarks" ? null : `/api/notes?${params.toString()}`);
  const bookmarks = useApi<BookmarkItem[]>(tab === "bookmarks" ? "/api/bookmarks" : null);
  const update = useAction((v: { id: string; body: string }) => api.patch(`/api/notes/${v.id}`, { body: v.body }), { invalidate: ["/api/notes"], success: "Anotação atualizada.", onSuccess: () => setEditing(null) });
  const remove = useAction((id: string) => api.del(`/api/notes/${id}`), { invalidate: ["/api/notes"], success: "Anotação excluída." });
  const removeBookmark = useAction((id: string) => api.del(`/api/bookmarks/${id}`), { invalidate: ["/api/bookmarks"] });
  const removeAll = useAction(() => api.del("/api/notes"), { invalidate: ["/api/notes", "/api/bookmarks"], success: "Todas as suas anotações foram excluídas." });

  const groups = new Map<string, NoteItem[]>();
  for (const n of notes.data ?? []) groups.set(n.contentId, [...(groups.get(n.contentId) ?? []), n]);

  return (
    <div>
      <PageHeader
        title="Minhas anotações"
        description="Anotações, dúvidas e marcadores são privados e ficam guardados na sua conta. Não são compartilhados com líderes."
        actions={
          <>
            <a href="/api/notes/export">
              <Button variant="outline" icon={Download}>Exportar</Button>
            </a>
            <ConfirmButton title="Excluir todas as anotações?" message="Anotações, dúvidas, destaques e marcadores serão excluídos permanentemente." confirmLabel="Excluir tudo" onConfirm={() => removeAll.mutateAsync(undefined)} icon={Trash2} size="md">
              Excluir tudo
            </ConfirmButton>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { id: "all", label: "Todas" },
          { id: "note", label: "Anotações" },
          { id: "doubt", label: "Minhas dúvidas" },
          { id: "bookmarks", label: "Marcadores" },
        ]}
      />
      {tab !== "bookmarks" && (
        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar nas anotações" placeholder="Buscar nas minhas anotações" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
      )}
      {tab === "bookmarks" ? (
        bookmarks.isLoading ? (
          <PageLoader />
        ) : bookmarks.error ? (
          <ErrorState error={bookmarks.error} />
        ) : !bookmarks.data?.length ? (
          <EmptyState icon={Bookmark} title="Nenhum marcador" description="Marque páginas importantes durante a leitura." />
        ) : (
          <Card className="divide-y divide-border">
            {bookmarks.data.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                <Bookmark className="h-4 w-4 text-primary" aria-hidden />
                <Link to={`/conteudos/${b.contentId}?pagina=${b.page}`} className="flex-1 hover:text-primary">
                  <span className="font-medium">{b.contentTitle}</span> <span className="text-sm text-muted">· página {b.page}{b.label ? ` · ${b.label}` : ""}</span>
                </Link>
                <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remover marcador" onClick={() => removeBookmark.mutate(b.id)} />
              </div>
            ))}
          </Card>
        )
      ) : notes.isLoading ? (
        <PageLoader />
      ) : notes.error ? (
        <ErrorState error={notes.error} />
      ) : !notes.data?.length ? (
        <EmptyState icon={NotebookPen} title={dq ? "Nada encontrado" : "Nenhuma anotação ainda"} description="Durante a leitura, use o painel de anotações para registrar aprendizados e dúvidas." />
      ) : (
        <div className="space-y-5">
          {[...groups.values()].map((items) => (
            <Card key={items[0]!.contentId} className="p-5">
              <Link to={`/conteudos/${items[0]!.contentId}`} className="hover:text-primary">
                <h2 className="font-heading text-base font-semibold">{items[0]!.contentTitle}</h2>
              </Link>
              <p className="text-xs text-muted">{items[0]!.trackTitle} · {items[0]!.moduleTitle}</p>
              <ul className="mt-3 space-y-3">
                {items.map((n) => (
                  <li key={n.id} className="rounded-xl border border-border p-3">
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      {n.kind === "doubt" && <Badge tone="warning">Dúvida</Badge>}
                      {n.page && (
                        <Link to={`/conteudos/${n.contentId}?pagina=${n.page}`} className="text-primary hover:underline">
                          Página {n.page}
                        </Link>
                      )}
                      <span className="ml-auto text-muted">{relativeTime(n.updatedAt)}</span>
                    </div>
                    {n.quote && <blockquote className="mb-1 border-l-2 border-border pl-2 text-sm text-muted">“{n.quote}”</blockquote>}
                    {editing === n.id ? (
                      <div className="space-y-2">
                        <Textarea aria-label="Editar anotação" value={draft} onChange={(e) => setDraft(e.target.value)} />
                        <div className="flex gap-2">
                          <Button size="sm" loading={update.isPending} onClick={() => update.mutate({ id: n.id, body: draft })}>Salvar</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-line text-sm">{n.body}</p>
                    )}
                    {editing !== n.id && (
                      <div className="mt-2 flex gap-1">
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setEditing(n.id); setDraft(n.body); }}>Editar</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} className="text-danger" onClick={() => remove.mutate(n.id)}>Excluir</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
