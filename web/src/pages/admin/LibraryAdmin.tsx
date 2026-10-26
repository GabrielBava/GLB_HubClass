import { useEffect, useState } from "react";
import { BookMarked, Download, FileText, ImageUp, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  LEVELS,
  LEVEL_LABEL,
  LIBRARY_LICENSES,
  LIBRARY_LICENSE_LABEL,
  LIBRARY_TYPES,
  LIBRARY_TYPE_LABEL,
  PUBLICATION_STATUS,
  PUBLICATION_STATUS_LABEL,
  type Level,
  type LibraryLicense,
  type LibraryType,
  type PublicationStatus,
} from "../../../../shared/domain";
import { useToast } from "../../components/toast";
import { Alert, Badge, Button, Checkbox, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, TableWrap, Textarea, td, th } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { fileSize } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { statusTone } from "./ContentTree";

interface Item {
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
  coverFileId: string | null;
  coverColor: string | null;
  externalUrl: string | null;
  fileId: string | null;
  file: { name: string; size: number } | null;
  allowDownload: boolean;
  areaId: string | null;
  status: PublicationStatus;
}
type Form = Omit<Item, "id" | "coverFileId" | "fileId" | "file"> & { id?: string };

const blank: Form = {
  title: "",
  author: "",
  category: "",
  theme: "",
  description: "",
  level: "basico",
  estimatedMinutes: null,
  type: "book",
  license: "own",
  coverColor: "#201E1E",
  externalUrl: "",
  allowDownload: true,
  areaId: null,
  status: "published",
};

const FILE_ACCEPT = ".pdf,.docx,.xlsx,.pptx,.epub,application/pdf";

export function LibraryAdminPage() {
  const { data, isLoading, error, refetch } = useApi<Item[]>("/api/admin/library");
  const [editing, setEditing] = useState<{ form: Form; item: Item | null } | null>(null);
  useDocumentTitle("Biblioteca");
  const remove = useAction((id: string) => api.del(`/api/admin/library/${id}`), { invalidate: ["/api/admin/library", "/api/library"], success: "Item removido." });

  return (
    <div>
      <PageHeader
        title="Biblioteca"
        description="Livros, artigos, publicações e materiais complementares, com foto de capa e arquivo para download. Obras protegidas por direitos autorais entram apenas como indicação, com link para a fonte oficial ou licenciada."
        actions={
          <Button icon={Plus} onClick={() => setEditing({ form: { ...blank }, item: null })}>
            Novo item
          </Button>
        }
      />
      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorState error={error} retry={refetch} />
      ) : data.length === 0 ? (
        <EmptyState icon={BookMarked} title="Biblioteca vazia" />
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Obra</th>
              <th className={th}>Tipo</th>
              <th className={th}>Arquivo e direitos</th>
              <th className={th}>Status</th>
              <th className={th}>
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((i) => (
              <tr key={i.id}>
                <td className={td}>
                  <div className="flex items-center gap-3">
                    <Cover item={i} className="h-14 w-10" />
                    <div className="min-w-0">
                      <p className="font-medium">{i.title}</p>
                      <p className="text-xs text-muted">{[i.author, i.category, i.theme].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                </td>
                <td className={td}>{LIBRARY_TYPE_LABEL[i.type]}</td>
                <td className={td}>
                  {i.file ? (
                    <p className="flex items-center gap-1.5 text-xs">
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-brand" aria-hidden />
                      <span className="min-w-0 max-w-[200px] truncate" title={i.file.name}>{i.file.name}</span>
                      <span className="shrink-0 whitespace-nowrap text-muted">· {fileSize(i.file.size)}</span>
                      {i.allowDownload ? <Badge tone="success">Download</Badge> : <Badge>Sem download</Badge>}
                    </p>
                  ) : (
                    <p className="text-xs text-muted">{i.externalUrl ? "Link externo" : "Sem arquivo"}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted">{LIBRARY_LICENSE_LABEL[i.license]}</p>
                </td>
                <td className={td}>
                  <Badge tone={statusTone(i.status)}>{PUBLICATION_STATUS_LABEL[i.status]}</Badge>
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      icon={Pencil}
                      aria-label="Editar item, capa e arquivo"
                      onClick={() => {
                        const { id, coverFileId: _c, fileId: _f, file: _file, ...rest } = i;
                        void _c;
                        void _f;
                        void _file;
                        setEditing({ form: { ...rest, id, externalUrl: rest.externalUrl ?? "" }, item: i });
                      }}
                    />
                    <ConfirmButton variant="ghost" icon={Trash2} title="Remover item" message={`“${i.title}” será removido da biblioteca.`} confirmLabel="Remover" onConfirm={() => remove.mutateAsync(i.id)}>
                      <span className="sr-only">Remover</span>
                    </ConfirmButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      {editing && <ItemModal initial={editing.form} item={editing.item} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Cover({ item, className, preview }: { item: Pick<Item, "coverFileId" | "coverColor">; className: string; preview?: string | null }) {
  const src = preview ?? (item.coverFileId ? `/api/files/${item.coverFileId}/image` : null);
  return src ? (
    <img src={src} alt="" className={`${className} shrink-0 rounded-md border border-border object-cover`} />
  ) : (
    <span className={`${className} grid shrink-0 place-items-center rounded-md border border-border text-white/80`} style={{ background: item.coverColor ?? "#201e1e" }} aria-hidden>
      <BookMarked className="h-4 w-4" />
    </span>
  );
}

/** Cadastro do item com capa e arquivo no mesmo formulário (enviados ao salvar). */
function ItemModal({ initial, item, onClose }: { initial: Form; item: Item | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: areas } = useApi<{ id: string; name: string }[]>("/api/admin/content/tree");
  const [form, setForm] = useState<Form>(initial);
  const [cover, setCover] = useState<File | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!cover) return setCoverPreview(null);
    const u = URL.createObjectURL(cover);
    setCoverPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [cover]);

  const canHost = form.license !== "external_only";
  const hasFile = !!attachment || (!!item?.file && !removeFile);

  const send = (id: string, kind: "file" | "cover", file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.upload(`/api/admin/library/${id}/${kind}`, fd);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { id: existing, ...body } = form;
      const payload = { ...body, externalUrl: body.externalUrl?.trim() || null, estimatedMinutes: body.estimatedMinutes || null, allowDownload: canHost && body.allowDownload };
      const saved = existing ? await api.patch<{ id: string }>(`/api/admin/library/${existing}`, payload) : await api.post<{ id: string }>("/api/admin/library", payload);
      const id = existing ?? saved.id;
      if (removeCover && !cover) await api.del(`/api/admin/library/${id}/cover`);
      if (cover) await send(id, "cover", cover);
      if (removeFile && !attachment) await api.del(`/api/admin/library/${id}/file`);
      if (attachment && canHost) {
        await send(id, "file", attachment);
        // O envio do arquivo libera o download; respeita a escolha de quem desmarcou a opção.
        if (!form.allowDownload) await api.patch(`/api/admin/library/${id}`, { allowDownload: false });
      }
      await qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && /^\/api\/(admin\/)?library/.test(q.queryKey[0]) });
      toast.success("Item salvo.");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={form.id ? "Editar item da biblioteca" : "Novo item da biblioteca"}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={saving} disabled={form.title.trim().length < 2} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        {/* Capa */}
        <div>
          <p className="mb-1.5 text-sm font-medium">Foto de capa</p>
          <Cover item={{ coverFileId: removeCover ? null : (item?.coverFileId ?? null), coverColor: form.coverColor }} preview={coverPreview} className="h-56 w-full max-w-[180px]" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-subtle">
              <ImageUp className="h-4 w-4" aria-hidden /> {cover || (item?.coverFileId && !removeCover) ? "Trocar" : "Enviar"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => {
                  setCover(e.target.files?.[0] ?? null);
                  setRemoveCover(false);
                  e.target.value = "";
                }}
              />
            </label>
            {(cover || (item?.coverFileId && !removeCover)) && (
              <Button
                size="sm"
                variant="ghost"
                icon={X}
                onClick={() => {
                  setCover(null);
                  setRemoveCover(true);
                }}
              >
                Remover
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">PNG, JPEG ou WebP, até 3 MB. Proporção de livro (3:4).</p>
          <Field label="Cor sem capa" htmlFor="l-color" className="mt-3">
            <Input id="l-color" type="color" className="h-10 p-1" value={form.coverColor ?? "#201E1E"} onChange={(e) => setForm({ ...form, coverColor: e.target.value })} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Título" htmlFor="l-title" required className="sm:col-span-2">
            <Input id="l-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field label="Autor" htmlFor="l-author">
            <Input id="l-author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
          </Field>
          <Field label="Tipo" htmlFor="l-type">
            <Select id="l-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LibraryType })} options={LIBRARY_TYPES.map((t) => ({ value: t, label: LIBRARY_TYPE_LABEL[t] }))} />
          </Field>
          <Field label="Direitos de uso" htmlFor="l-license" className="sm:col-span-2" hint="Arquivos só podem ser hospedados para conteúdo próprio, licenciado ou de licença aberta.">
            <Select
              id="l-license"
              value={form.license}
              onChange={(e) => setForm({ ...form, license: e.target.value as LibraryLicense })}
              options={LIBRARY_LICENSES.map((l) => ({ value: l, label: LIBRARY_LICENSE_LABEL[l] }))}
            />
          </Field>

          {/* Arquivo para download */}
          <div className="rounded-xl border border-border p-4 sm:col-span-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-brand" aria-hidden /> Arquivo para download
            </p>
            {canHost ? (
              <>
                {hasFile && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <Paperclip className="h-4 w-4 text-muted" aria-hidden />
                    <span className="min-w-0 truncate">{attachment ? attachment.name : item?.file?.name}</span>
                    <span className="text-xs text-muted">{fileSize(attachment ? attachment.size : (item?.file?.size ?? 0))}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={X}
                      onClick={() => {
                        setAttachment(null);
                        setRemoveFile(true);
                      }}
                    >
                      Remover
                    </Button>
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium hover:bg-subtle">
                    <Paperclip className="h-4 w-4" aria-hidden /> {hasFile ? "Trocar arquivo" : "Anexar arquivo"}
                    <input
                      type="file"
                      accept={FILE_ACCEPT}
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setAttachment(f);
                        if (f) setForm((cur) => ({ ...cur, allowDownload: true }));
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <span className="text-xs text-muted">PDF, Word, Excel, PowerPoint ou EPUB, até 50 MB. O arquivo passa pela verificação antivírus.</span>
                </div>
                <div className="mt-3">
                  <Checkbox label="Permitir que os colaboradores baixem o arquivo" checked={form.allowDownload} disabled={!hasFile} onChange={(v) => setForm({ ...form, allowDownload: v })} />
                </div>
              </>
            ) : (
              <div className="mt-2">
                <Alert tone="info">
                  Para anexar um arquivo, escolha em Direitos de uso: conteúdo próprio, licenciado ou de licença aberta. Obras sem autorização de distribuição entram só como indicação, com link oficial.
                </Alert>
              </div>
            )}
          </div>

          <Field label="Categoria" htmlFor="l-cat">
            <Input id="l-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
          <Field label="Tema" htmlFor="l-theme">
            <Input id="l-theme" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} />
          </Field>
          <Field label="Descrição" htmlFor="l-desc" className="sm:col-span-2">
            <Textarea id="l-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Nível" htmlFor="l-level">
            <Select id="l-level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as Level })} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} />
          </Field>
          <Field label="Tempo estimado (min)" htmlFor="l-min">
            <Input id="l-min" type="number" min={1} value={form.estimatedMinutes ?? ""} onChange={(e) => setForm({ ...form, estimatedMinutes: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          <Field label="Área relacionada" htmlFor="l-area">
            <Select id="l-area" value={form.areaId ?? ""} placeholder="Nenhuma" onChange={(e) => setForm({ ...form, areaId: e.target.value || null })} options={(areas ?? []).map((a) => ({ value: a.id, label: a.name }))} />
          </Field>
          <Field label="Status" htmlFor="l-status">
            <Select id="l-status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as PublicationStatus })} options={PUBLICATION_STATUS.map((s) => ({ value: s, label: PUBLICATION_STATUS_LABEL[s] }))} />
          </Field>
          <Field label="Link oficial ou licenciado (https, opcional)" htmlFor="l-url" className="sm:col-span-2">
            <Input id="l-url" type="url" placeholder="https://" value={form.externalUrl ?? ""} onChange={(e) => setForm({ ...form, externalUrl: e.target.value })} />
          </Field>
          {item?.file && item.allowDownload && (
            <p className="flex items-center gap-1.5 text-xs text-muted sm:col-span-2">
              <Download className="h-3.5 w-3.5" aria-hidden /> Cada download fica registrado na auditoria.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
