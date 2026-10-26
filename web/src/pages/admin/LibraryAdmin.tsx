import { useRef, useState } from "react";
import { BookMarked, FileUp, ImageUp, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Alert, Badge, Button, Checkbox, ConfirmButton, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, TableWrap, Textarea, td, th } from "../../components/ui";
import { api } from "../../lib/api";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
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
  allowDownload: boolean;
  areaId: string | null;
  status: PublicationStatus;
}
type Form = Omit<Item, "id" | "coverFileId" | "fileId"> & { id?: string };

const blank: Form = {
  title: "",
  author: "",
  category: "",
  theme: "",
  description: "",
  level: "basico",
  estimatedMinutes: null,
  type: "book",
  license: "external_only",
  coverColor: "#252522",
  externalUrl: "",
  allowDownload: false,
  areaId: null,
  status: "published",
};

export function LibraryAdminPage() {
  const { data, isLoading, error, refetch } = useApi<Item[]>("/api/admin/library");
  const { data: areas } = useApi<{ id: string; name: string }[]>("/api/admin/content/tree");
  const [form, setForm] = useState<Form | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<string | null>(null);
  useDocumentTitle("Biblioteca");
  const inv = { invalidate: ["/api/admin/library", "/api/library"] };
  const save = useAction(
    () => {
      const { id, ...body } = form!;
      const payload = { ...body, externalUrl: body.externalUrl?.trim() || null, estimatedMinutes: body.estimatedMinutes || null };
      return id ? api.patch(`/api/admin/library/${id}`, payload) : api.post("/api/admin/library", payload);
    },
    { ...inv, success: "Item salvo.", onSuccess: () => setForm(null) },
  );
  const remove = useAction((id: string) => api.del(`/api/admin/library/${id}`), { ...inv, success: "Item removido." });
  const upload = useAction(
    (v: { id: string; kind: "file" | "cover"; file: File }) => {
      const fd = new FormData();
      fd.append("file", v.file);
      return api.upload(`/api/admin/library/${v.id}/${v.kind}`, fd);
    },
    { ...inv, success: "Arquivo enviado." },
  );

  const pick = (id: string, kind: "file" | "cover") => {
    setTarget(id);
    (kind === "file" ? fileRef : coverRef).current?.click();
  };
  const onPicked = (kind: "file" | "cover") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && target) upload.mutate({ id: target, kind, file: f });
    e.target.value = "";
  };

  return (
    <div>
      <PageHeader
        title="Biblioteca"
        description="Livros, artigos, publicações e materiais complementares. Obras protegidas por direitos autorais entram apenas como indicação, com link para fonte oficial ou licenciada."
        actions={
          <Button icon={Plus} onClick={() => setForm({ ...blank })}>
            Novo item
          </Button>
        }
      />
      <input ref={fileRef} type="file" accept="application/pdf" className="sr-only" onChange={onPicked("file")} />
      <input ref={coverRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={onPicked("cover")} />
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
              <th className={th}>Direitos</th>
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
                    {i.coverFileId ? (
                      <img src={`/api/files/${i.coverFileId}/image`} alt="" className="h-12 w-9 rounded object-cover" />
                    ) : (
                      <span className="h-12 w-9 rounded" style={{ background: i.coverColor ?? "var(--accent)" }} aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium">{i.title}</p>
                      <p className="text-xs text-muted">
                        {[i.author, i.category, i.theme].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                </td>
                <td className={td}>{LIBRARY_TYPE_LABEL[i.type]}</td>
                <td className={td}>
                  <p className="text-xs">{LIBRARY_LICENSE_LABEL[i.license]}</p>
                  <p className="text-xs text-muted">
                    {i.fileId ? "Arquivo hospedado" : i.externalUrl ? "Link externo" : "Sem acesso cadastrado"}
                    {i.allowDownload ? " · download permitido" : ""}
                  </p>
                </td>
                <td className={td}>
                  <Badge tone={statusTone(i.status)}>{PUBLICATION_STATUS_LABEL[i.status]}</Badge>
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <div className="flex justify-end gap-1">
                    <Button size="icon" variant="ghost" icon={ImageUp} aria-label="Enviar capa" onClick={() => pick(i.id, "cover")} />
                    {i.license !== "external_only" && <Button size="icon" variant="ghost" icon={FileUp} aria-label="Enviar PDF" onClick={() => pick(i.id, "file")} />}
                    <Button
                      size="icon"
                      variant="ghost"
                      icon={Pencil}
                      aria-label="Editar"
                      onClick={() => {
                        const { coverFileId: _c, fileId: _f, ...rest } = i;
                        void _c;
                        void _f;
                        setForm({ ...rest, externalUrl: rest.externalUrl ?? "" });
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

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Editar item" : "Novo item da biblioteca"}
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button loading={save.isPending} disabled={!form || form.title.trim().length < 2} onClick={() => save.mutate(undefined)}>
              Salvar
            </Button>
          </>
        }
      >
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Título" htmlFor="l-title" required className="sm:col-span-2">
              <Input id="l-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Autor" htmlFor="l-author">
              <Input id="l-author" value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} />
            </Field>
            <Field label="Tipo" htmlFor="l-type">
              <Select id="l-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LibraryType })} options={LIBRARY_TYPES.map((t) => ({ value: t, label: LIBRARY_TYPE_LABEL[t] }))} />
            </Field>
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
            <Field label="Direitos de uso" htmlFor="l-license" className="sm:col-span-2" hint="Sem autorização de distribuição, a obra entra apenas como indicação, com link oficial.">
              <Select
                id="l-license"
                value={form.license}
                onChange={(e) => {
                  const license = e.target.value as LibraryLicense;
                  setForm({ ...form, license, allowDownload: license === "external_only" ? false : form.allowDownload });
                }}
                options={LIBRARY_LICENSES.map((l) => ({ value: l, label: LIBRARY_LICENSE_LABEL[l] }))}
              />
            </Field>
            <Field label="Link oficial ou licenciado (https)" htmlFor="l-url" className="sm:col-span-2">
              <Input id="l-url" type="url" placeholder="https://" value={form.externalUrl ?? ""} onChange={(e) => setForm({ ...form, externalUrl: e.target.value })} />
            </Field>
            <Field label="Cor da capa" htmlFor="l-color" hint="Usada quando não houver imagem de capa.">
              <Input id="l-color" type="color" className="h-11 p-1" value={form.coverColor ?? "#252522"} onChange={(e) => setForm({ ...form, coverColor: e.target.value })} />
            </Field>
            <div className="pt-7">
              <Checkbox label="Permitir download do PDF" disabled={form.license === "external_only"} checked={form.allowDownload} onChange={(v) => setForm({ ...form, allowDownload: v })} />
            </div>
            {form.license === "external_only" && (
              <div className="sm:col-span-2">
                <Alert tone="info">Não hospede cópias de livros ou materiais sem autorização. Indique o título e direcione para a fonte oficial.</Alert>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
