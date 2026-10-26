import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Eye, FileUp, Loader2, Save, ShieldCheck, Trash2 } from "lucide-react";
import { CONTENT_TYPE_LABEL, LEVELS, LEVEL_LABEL, type ContentType, type Level, type PublicationStatus } from "../../../../shared/domain";
import { useToast } from "../../components/toast";
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmButton, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, TableWrap, Textarea, td, th } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fileSize, formatDateTime, formatMinutes } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { NotFoundPage } from "../Errors";
import { RevisionsButton, setStatus, StatusActions } from "./shared";

interface ContentFull {
  id: string;
  moduleId: string;
  type: ContentType;
  title: string;
  description: string;
  learningObjective: string;
  level: Level | null;
  ownerName: string;
  isRequired: boolean;
  allowDownload: boolean;
  allowTextMode: boolean | null;
  commentsEnabled: boolean | null;
  status: PublicationStatus;
  currentVersionId: string | null;
  estimatedMinutesOverride: number | null;
  readingFactor: number;
  dependsOnContentId: string | null;
  externalUrl: string | null;
  bodyText: string | null;
}
interface Version {
  id: string;
  number: number;
  isCurrent: boolean;
  pageCount: number;
  wordCount: number;
  processingStatus: "pending" | "processing" | "ready" | "failed";
  processingError: string | null;
  changeNotes: string;
  isMajor: boolean;
  createdAt: string;
  publishedAt: string | null;
  author: string | null;
  file: { name: string; size: number; sha256: string; scanStatus: string; scanDetail: string | null } | null;
}
interface EditorData {
  content: ContentFull;
  reading: { wordsPerMinute: number; automaticMinutes: number };
  module: { id: string; title: string };
  track: { id: string; title: string; areaId: string };
  permissions: { canEdit: boolean; canPublish: boolean };
  versions: Version[];
  siblings: { id: string; title: string }[];
}

const PROCESSING_LABEL: Record<Version["processingStatus"], string> = { pending: "Na fila", processing: "Processando", ready: "Pronta", failed: "Falhou" };
const SCAN_LABEL: Record<string, string> = { clean: "Sem ameaças", skipped: "Verificação não configurada", infected: "Bloqueado: ameaça detectada", error: "Falha na verificação", pending: "Aguardando verificação" };

const triState = (v: boolean | null) => (v === null ? "" : v ? "yes" : "no");
const fromTriState = (v: string) => (v === "" ? null : v === "yes");

export function ContentEditorPage() {
  const { id = "" } = useParams();
  const url = `/api/admin/contents/${id}`;
  const { me } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [processing, setProcessing] = useState(false);
  const { data, isLoading, error, refetch } = useApi<EditorData>(url, { refetchInterval: processing ? 2500 : false });
  const [form, setForm] = useState<ContentFull | null>(null);
  const [upload, setUpload] = useState<{ file: File | null; changeNotes: string; isMajor: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ version: Version; page: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useDocumentTitle(data?.content.title);

  useEffect(() => {
    if (!data) return;
    setForm((f) => (f && f.id === data.content.id ? { ...f, status: data.content.status, currentVersionId: data.content.currentVersionId } : data.content));
    setProcessing(data.versions.some((v) => v.processingStatus === "pending" || v.processingStatus === "processing"));
  }, [data]);

  const inv = { invalidate: [url, "/api/admin/tracks", "/api/admin/content", "/api/catalog", "/api/tracks", "/api/contents"] };
  const save = useAction(
    () =>
      api.patch(url, {
        title: form!.title,
        description: form!.description,
        learningObjective: form!.learningObjective,
        level: form!.level,
        ownerName: form!.ownerName,
        isRequired: form!.isRequired,
        allowDownload: form!.allowDownload,
        allowTextMode: form!.allowTextMode,
        commentsEnabled: form!.commentsEnabled,
        estimatedMinutesOverride: form!.estimatedMinutesOverride || null,
        readingFactor: form!.readingFactor,
        dependsOnContentId: form!.dependsOnContentId,
        externalUrl: form!.externalUrl?.trim() ? form!.externalUrl.trim() : null,
        bodyText: form!.type === "text" ? form!.bodyText ?? "" : form!.bodyText,
      }),
    { ...inv, success: "Conteúdo salvo." },
  );
  const status = useAction((s: PublicationStatus) => setStatus("contents", id, s), { ...inv, success: "Status atualizado." });
  const activate = useAction((versionId: string) => api.post(`${url}/versions/${versionId}/activate`), { ...inv, success: "Versão ativada. Os colaboradores passam a ver esta versão." });
  const remove = useAction(() => api.del(url), { ...inv, success: "Conteúdo excluído.", onSuccess: () => navigate(data ? `/admin/trilhas/${data.track.id}` : "/admin/conteudos") });

  if (isLoading || (data && !form)) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data || !form) return <ErrorState error={error} retry={refetch} />;
  const { permissions: p, content: c } = data;
  const set = (patch: Partial<ContentFull>) => setForm({ ...form, ...patch });
  const current = data.versions.find((v) => v.isCurrent) ?? null;
  // Cálculo automático com o fator salvo (palavras por minuto da área ou da plataforma).
  const estimate = current && data.reading.automaticMinutes > 0 ? data.reading.automaticMinutes : null;

  const sendUpload = async () => {
    if (!upload?.file) return;
    const fd = new FormData();
    // Os campos de texto precisam vir antes do arquivo (o servidor lê o fluxo em sequência).
    fd.append("changeNotes", upload.changeNotes);
    fd.append("isMajor", String(upload.isMajor));
    fd.append("file", upload.file);
    setUploading(true);
    try {
      const r = await api.upload<{ number: number; scan: { status: string }; flags: string[] }>(`${url}/versions`, fd);
      toast.success(`Versão ${r.number} recebida. O processamento das páginas começou.`);
      if (r.flags.length) toast.info(`Atenção: ${r.flags.join(" ")}`);
      setUpload(null);
      setProcessing(true);
      void refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Link to={`/admin/trilhas/${data.track.id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> {data.track.title} · {data.module.title}
      </Link>
      <PageHeader
        eyebrow={CONTENT_TYPE_LABEL[c.type]}
        title={c.title}
        actions={
          <>
            <RevisionsButton entityType="content" entityId={id} />
            {c.status === "published" && (
              <Link to={`/conteudos/${id}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium hover:bg-subtle">
                <Eye className="h-4 w-4" aria-hidden /> Ver como colaborador
              </Link>
            )}
          </>
        }
      >
        <div className="mt-3">
          <StatusActions status={c.status} canEdit={p.canEdit} canPublish={p.canPublish} loading={status.isPending} onChange={(s) => status.mutate(s)} />
        </div>
      </PageHeader>

      {c.type === "document" && !c.currentVersionId && (
        <div className="mb-5">
          <Alert tone="warning" title="Apostila sem arquivo">
            Envie o PDF (ou DOCX, quando a conversão estiver habilitada). A publicação só é liberada depois que as páginas forem processadas.
          </Alert>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-5">
          <CardHeader flush title="Dados do conteúdo" description="Título, objetivo, nível, responsável e regras de acesso." />
          <fieldset disabled={!p.canEdit} className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Título" htmlFor="c-title" required className="sm:col-span-2">
              <Input id="c-title" value={form.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Descrição" htmlFor="c-desc" className="sm:col-span-2">
              <Textarea id="c-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field label="Objetivo de aprendizagem" htmlFor="c-obj" className="sm:col-span-2">
              <Textarea id="c-obj" value={form.learningObjective} onChange={(e) => set({ learningObjective: e.target.value })} />
            </Field>
            <Field label="Nível" htmlFor="c-level">
              <Select id="c-level" value={form.level ?? ""} placeholder="Mesmo da trilha" onChange={(e) => set({ level: (e.target.value || null) as Level | null })} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} />
            </Field>
            <Field label="Responsável pelo conteúdo" htmlFor="c-owner">
              <Input id="c-owner" value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />
            </Field>
            <Field label="Depende de" htmlFor="c-dep" hint="O colaborador só acessa depois de concluir o conteúdo indicado.">
              <Select id="c-dep" value={form.dependsOnContentId ?? ""} placeholder="Sem dependência" onChange={(e) => set({ dependsOnContentId: e.target.value || null })} options={data.siblings.map((s) => ({ value: s.id, label: s.title }))} />
            </Field>
            <Field label="Tempo estimado manual (min)" htmlFor="c-min" hint={estimate ? `Cálculo automático: ${formatMinutes(estimate)} (${data.reading.wordsPerMinute} palavras/min). Vazio = usar o cálculo.` : "Vazio = usar o cálculo automático."}>
              <Input id="c-min" type="number" min={1} value={form.estimatedMinutesOverride ?? ""} onChange={(e) => set({ estimatedMinutesOverride: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            {c.type === "document" && (
              <Field label="Fator de complexidade" htmlFor="c-factor" hint="Use mais de 1 para materiais técnicos, com tabelas, fórmulas ou exercícios.">
                <Select
                  id="c-factor"
                  value={String(form.readingFactor)}
                  onChange={(e) => set({ readingFactor: Number(e.target.value) })}
                  options={[
                    { value: "1", label: "Padrão (1×)" },
                    { value: "1.25", label: "Moderado (1,25×)" },
                    { value: "1.5", label: "Técnico (1,5×)" },
                    { value: "2", label: "Muito técnico (2×)" },
                  ]}
                />
              </Field>
            )}
            {(c.type === "video" || c.type === "audio" || c.type === "link") && (
              <Field label="Endereço (https)" htmlFor="c-url" className="sm:col-span-2" hint="Vídeos e áudios devem estar em plataforma corporativa com controle de acesso.">
                <Input id="c-url" type="url" placeholder="https://" value={form.externalUrl ?? ""} onChange={(e) => set({ externalUrl: e.target.value })} />
              </Field>
            )}
            {c.type === "text" && (
              <Field label="Texto do conteúdo" htmlFor="c-body" className="sm:col-span-2" hint="Parágrafos separados por linha em branco.">
                <Textarea id="c-body" className="min-h-[240px]" value={form.bodyText ?? ""} onChange={(e) => set({ bodyText: e.target.value })} />
              </Field>
            )}
            <div className="space-y-3 sm:col-span-2">
              <Checkbox label="Conteúdo obrigatório" description="Conta para a conclusão da trilha." checked={form.isRequired} onChange={(v) => set({ isRequired: v })} />
              {c.type === "document" && (
                <Checkbox
                  label="Permitir download do arquivo"
                  description={p.canPublish ? "Desativado por padrão. O download fica registrado no histórico." : "Somente quem pode publicar na área altera esta opção."}
                  checked={form.allowDownload}
                  disabled={!p.canPublish}
                  onChange={(v) => set({ allowDownload: v })}
                />
              )}
            </div>
            {c.type === "document" && (
              <Field label="Modo texto acessível" htmlFor="c-text">
                <Select id="c-text" value={triState(form.allowTextMode)} onChange={(e) => set({ allowTextMode: fromTriState(e.target.value) })} options={[{ value: "", label: "Padrão da plataforma" }, { value: "yes", label: "Permitir" }, { value: "no", label: "Não permitir" }]} />
              </Field>
            )}
            <Field label="Dúvidas e comentários" htmlFor="c-comments">
              <Select id="c-comments" value={triState(form.commentsEnabled)} onChange={(e) => set({ commentsEnabled: fromTriState(e.target.value) })} options={[{ value: "", label: "Padrão da área" }, { value: "yes", label: "Permitir" }, { value: "no", label: "Não permitir" }]} />
            </Field>
          </fieldset>
          {p.canEdit && (
            <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-border pt-4">
              {c.status === "draft" && p.canPublish ? (
                <ConfirmButton variant="ghost" icon={Trash2} title="Excluir conteúdo" message="O conteúdo em rascunho e suas versões serão removidos. Esta ação não pode ser desfeita." confirmLabel="Excluir" onConfirm={() => remove.mutateAsync(undefined)}>
                  Excluir rascunho
                </ConfirmButton>
              ) : (
                <span />
              )}
              <Button icon={Save} loading={save.isPending} disabled={form.title.trim().length < 2} onClick={() => save.mutate(undefined)}>
                Salvar alterações
              </Button>
            </div>
          )}
        </Card>

        {c.type === "document" && (
          <div className="space-y-5">
            <Card className="p-5">
              <CardHeader flush
                icon={ShieldCheck}
                title="Arquivo protegido"
                description="O original fica em armazenamento privado. Os colaboradores recebem somente páginas renderizadas, com marca d'água individual."
              />
              {current ? (
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted">Versão atual</dt>
                    <dd className="font-semibold">v{current.number}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Páginas</dt>
                    <dd className="font-semibold">{current.pageCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Palavras</dt>
                    <dd className="font-semibold">{current.wordCount.toLocaleString("pt-BR")}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Leitura estimada</dt>
                    <dd className="font-semibold">{formatMinutes(form.estimatedMinutesOverride ?? estimate ?? 0)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 text-sm text-muted">Nenhuma versão ativa.</p>
              )}
              {p.canEdit && (
                <Button className="mt-4 w-full" icon={FileUp} onClick={() => setUpload({ file: null, changeNotes: "", isMajor: !!current })}>
                  {current ? "Enviar nova versão" : "Enviar arquivo"}
                </Button>
              )}
            </Card>
            {processing && (
              <Alert tone="info" icon={Loader2} title="Processando páginas">
                As páginas estão sendo convertidas em imagens protegidas e o texto está sendo extraído para o cálculo do tempo de leitura. Esta tela atualiza sozinha.
              </Alert>
            )}
          </div>
        )}
      </div>

      {c.type === "document" && data.versions.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <div className="p-5 pb-3">
            <CardHeader flush title="Versões" description="Toda troca de arquivo gera uma nova versão. O progresso dos colaboradores é preservado." />
          </div>
          <TableWrap>
              <thead>
                <tr>
                  <th className={th}>Versão</th>
                  <th className={th}>Arquivo</th>
                  <th className={th}>Processamento</th>
                  <th className={th}>Verificação</th>
                  <th className={th}>Enviada</th>
                  <th className={th}>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.versions.map((v) => (
                  <tr key={v.id}>
                    <td className={td}>
                      <span className="font-semibold">v{v.number}</span> {v.isCurrent && <Badge tone="success">Atual</Badge>} {v.isMajor && <Badge tone="info">Relevante</Badge>}
                      {v.changeNotes && <p className="mt-1 max-w-xs text-xs text-muted">{v.changeNotes}</p>}
                    </td>
                    <td className={td}>
                      {v.file ? (
                        <>
                          <p className="max-w-[220px] truncate" title={v.file.name}>{v.file.name}</p>
                          <p className="text-xs text-muted">
                            {fileSize(v.file.size)} · {v.pageCount} pág. · SHA-256 {v.file.sha256.slice(0, 10)}…
                          </p>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={td}>
                      <Badge tone={v.processingStatus === "ready" ? "success" : v.processingStatus === "failed" ? "danger" : "info"}>{PROCESSING_LABEL[v.processingStatus]}</Badge>
                      {v.processingError && <p className="mt-1 max-w-xs text-xs text-danger">{v.processingError}</p>}
                    </td>
                    <td className={td}>
                      {v.file && (
                        <span className="inline-flex items-center gap-1 text-xs">
                          {v.file.scanStatus === "clean" ? <CheckCircle2 className="h-4 w-4 text-success" /> : v.file.scanStatus === "infected" || v.file.scanStatus === "error" ? <AlertTriangle className="h-4 w-4 text-danger" /> : null}
                          {SCAN_LABEL[v.file.scanStatus] ?? v.file.scanStatus}
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      <p>{formatDateTime(v.createdAt)}</p>
                      <p className="text-xs text-muted">{v.author ?? "—"}</p>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <div className="flex justify-end gap-1">
                        {v.processingStatus === "ready" && v.pageCount > 0 && (
                          <Button size="sm" variant="ghost" icon={Eye} onClick={() => setPreview({ version: v, page: 1 })}>
                            Prévia
                          </Button>
                        )}
                        {v.processingStatus === "ready" && !v.isCurrent && p.canEdit && (
                          <Button size="sm" variant="outline" loading={activate.isPending} onClick={() => activate.mutate(v.id)}>
                            Ativar
                          </Button>
                        )}
                        {me?.user.role === "admin" && v.file && (
                          <a className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted hover:bg-subtle hover:text-fg" href={`/api/admin/versions/${v.id}/original`} title="Download do original (registrado na auditoria)">
                            <Download className="h-4 w-4" /> Original
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
          </TableWrap>
        </Card>
      )}

      <Modal
        open={!!upload}
        onClose={() => !uploading && setUpload(null)}
        title={current ? "Nova versão da apostila" : "Enviar apostila"}
        description="PDF de até o limite configurado. O arquivo é verificado, armazenado de forma privada e convertido em páginas protegidas."
        footer={
          <>
            <Button variant="ghost" disabled={uploading} onClick={() => setUpload(null)}>
              Cancelar
            </Button>
            <Button icon={FileUp} loading={uploading} disabled={!upload?.file} onClick={() => void sendUpload()}>
              Enviar
            </Button>
          </>
        }
      >
        {upload && (
          <div className="space-y-4">
            <Field label="Arquivo" htmlFor="v-file" required hint="Formatos: PDF ou DOCX (se a conversão estiver habilitada no servidor).">
              <input
                ref={fileRef}
                id="v-file"
                type="file"
                accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-subtle file:px-3 file:py-2 file:text-sm file:font-medium"
                onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })}
              />
            </Field>
            <Field label="O que mudou nesta versão?" htmlFor="v-notes" hint="Aparece no aviso enviado aos colaboradores matriculados.">
              <Textarea id="v-notes" value={upload.changeNotes} maxLength={2000} onChange={(e) => setUpload({ ...upload, changeNotes: e.target.value })} />
            </Field>
            {current && (
              <Checkbox
                label="Atualização relevante"
                description="Quando ativada, avisa os colaboradores matriculados que a apostila obrigatória mudou."
                checked={upload.isMajor}
                onChange={(v) => setUpload({ ...upload, isMajor: v })}
              />
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `Prévia · v${preview.version.number}` : ""} description="Pré-visualização com a sua marca d'água de revisão." size="xl">
        {preview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" disabled={preview.page <= 1} onClick={() => setPreview({ ...preview, page: preview.page - 1 })}>
                Anterior
              </Button>
              <span className="text-sm text-muted">
                Página {preview.page} de {preview.version.pageCount}
              </span>
              <Button size="sm" variant="outline" disabled={preview.page >= preview.version.pageCount} onClick={() => setPreview({ ...preview, page: preview.page + 1 })}>
                Próxima
              </Button>
            </div>
            <div className="protected-page overflow-hidden rounded-xl border border-border bg-white" onContextMenu={(e) => e.preventDefault()}>
              <img src={`/api/admin/versions/${preview.version.id}/pages/${preview.page}`} alt={`Página ${preview.page}`} className="mx-auto w-full" draggable={false} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
