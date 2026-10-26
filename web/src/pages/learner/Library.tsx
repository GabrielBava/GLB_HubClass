import { useState } from "react";
import { BookOpen, Download, ExternalLink, Headphones, Link2, Newspaper, PlayCircle, Search } from "lucide-react";
import { LEVEL_LABEL, LIBRARY_LICENSE_LABEL, LIBRARY_TYPES, LIBRARY_TYPE_LABEL, type Level, type LibraryLicense, type LibraryType } from "../../../../shared/domain";
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, PageLoader, Select } from "../../components/ui";
import { fileSize, formatMinutes } from "../../lib/format";
import { useApi, useDebounced, useDocumentTitle } from "../../lib/hooks";

interface LibraryItem {
  id: string;
  title: string;
  author: string;
  category: string;
  theme: string;
  description: string;
  level: Level;
  estimatedMinutes: number | null;
  type: LibraryType;
  license: LibraryLicense;
  coverColor: string | null;
  coverFileId: string | null;
  externalUrl: string | null;
  canDownload: boolean;
  download: { ext: string; size: number } | null;
  areaName: string | null;
}

const typeIcon: Record<LibraryType, typeof BookOpen> = { book: BookOpen, ebook: BookOpen, article: Newspaper, publication: Newspaper, video: PlayCircle, podcast: Headphones, link: Link2 };

export function LibraryPage() {
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  useDocumentTitle("Biblioteca");
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (category) params.set("category", category);
  if (dq) params.set("q", dq);
  const { data, isLoading, error, refetch } = useApi<{ items: LibraryItem[]; categories: string[] }>(`/api/library?${params.toString()}`);
  return (
    <div>
      <PageHeader title="Biblioteca e desenvolvimento" description="Livros, artigos, podcasts e materiais complementares. Obras comerciais aparecem como indicação, com sinopse e link oficial — sem cópias não autorizadas." />
      <Card className="mb-6 grid gap-2 p-4 sm:grid-cols-[1fr_200px_200px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar na biblioteca" placeholder="Buscar por título, autor ou tema" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" />
        </div>
        <Select aria-label="Tipo" value={type} onChange={(e) => setType(e.target.value)} placeholder="Todos os tipos" options={LIBRARY_TYPES.map((t) => ({ value: t, label: LIBRARY_TYPE_LABEL[t] }))} />
        <Select aria-label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Todas as categorias" options={(data?.categories ?? []).map((c) => ({ value: c, label: c }))} />
      </Card>
      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState error={error} retry={refetch} />
      ) : !data.items.length ? (
        <EmptyState icon={BookOpen} title="Nenhum item encontrado" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((item) => {
            const Icon = typeIcon[item.type];
            return (
              <Card as="article" key={item.id} className="flex gap-4 p-4">
                {item.coverFileId ? (
                  <img src={`/api/files/${item.coverFileId}/image`} alt={`Capa de ${item.title}`} className="h-40 w-28 shrink-0 rounded-lg object-cover shadow-sm" />
                ) : (
                  <div className="grid h-40 w-28 shrink-0 place-items-center rounded-lg text-white/90" style={{ background: item.coverColor ?? "var(--surface-2)" }} aria-hidden>
                    <Icon className="h-8 w-8" />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex flex-wrap gap-1">
                    <Badge>{LIBRARY_TYPE_LABEL[item.type]}</Badge>
                    {item.category && <Badge tone="primary">{item.category}</Badge>}
                  </div>
                  <h2 className="mt-1.5 font-heading font-semibold leading-snug">{item.title}</h2>
                  <p className="text-xs text-muted">{item.author}</p>
                  <p className="mt-1 line-clamp-3 text-sm text-muted">{item.description}</p>
                  <p className="mt-1 text-xs text-muted">
                    {LEVEL_LABEL[item.level]}
                    {item.estimatedMinutes ? ` · ${formatMinutes(item.estimatedMinutes)}` : ""}
                    {item.theme ? ` · ${item.theme}` : ""}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-2 pt-3">
                    {item.canDownload && (
                      <a href={`/api/library/${item.id}/file`} download>
                        <Button size="sm" icon={Download}>
                          Baixar{item.download?.ext ? ` ${item.download.ext}` : ""}
                          {item.download?.size ? <span className="font-normal opacity-80">· {fileSize(item.download.size)}</span> : null}
                        </Button>
                      </a>
                    )}
                    {item.externalUrl && (
                      <a href={item.externalUrl} target="_blank" rel="noopener noreferrer">
                        <Button size="sm" variant="outline" icon={ExternalLink}>Acessar</Button>
                      </a>
                    )}
                    {!item.canDownload && !item.externalUrl && <span className="text-xs text-muted">{LIBRARY_LICENSE_LABEL[item.license]}</span>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
