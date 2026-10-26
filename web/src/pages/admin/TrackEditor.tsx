import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowDown, ArrowLeft, ArrowUp, ClipboardCheck, ExternalLink, FileText, Hammer, ImageUp, Pencil, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import {
  ASSESSMENT_KINDS,
  ASSESSMENT_KIND_LABEL,
  CONTENT_TYPES,
  CONTENT_TYPE_LABEL,
  LEVELS,
  LEVEL_LABEL,
  PRACTICE_STAGES,
  PRACTICE_STAGE_LABEL,
  TRACK_MODES,
  TRACK_MODE_LABEL,
  type AssessmentKind,
  type ContentType,
  type Level,
  type PracticeStage,
  type PublicationStatus,
  type TrackMode,
} from "../../../../shared/domain";
import { useToast } from "../../components/toast";
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmButton, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Textarea } from "../../components/ui";
import { api, ApiError, errorMessage } from "../../lib/api";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";
import { NotFoundPage } from "../Errors";
import { statusTone } from "./ContentTree";
import { RevisionsButton, setStatus, StatusActions } from "./shared";

interface TrackFull {
  id: string;
  areaId: string;
  title: string;
  summary: string;
  description: string;
  objectives: string;
  prerequisitesText: string;
  specialty: string;
  level: Level;
  mode: TrackMode;
  dependsOnTrackId: string | null;
  estimatedMinutesOverride: number | null;
  coverColor: string | null;
  coverFileId: string | null;
  status: PublicationStatus;
  lockedVisibility: "locked" | "hidden" | null;
  requiresLeaderValidation: boolean;
  certificateEnabled: boolean;
  commentsEnabled: boolean;
  isRampUp: boolean;
  rampDays: number | null;
  ownerName: string;
  version: number;
  jobTitleIds: string[];
}
interface EditorData {
  track: TrackFull;
  area: { id: string; name: string; color: string };
  permissions: { canEdit: boolean; canPublish: boolean };
  modules: {
    id: string;
    code: string | null;
    title: string;
    description: string;
    objectives: string;
    status: PublicationStatus;
    requiresPrevious: boolean;
    estimatedMinutesOverride: number | null;
    contents: { id: string; title: string; type: ContentType; status: PublicationStatus; isRequired: boolean; currentVersion: { number: number; pageCount: number; processingStatus: string } | null; latestVersion: { number: number; processingStatus: string; processingError: string | null } | null }[];
    assessments: { id: string; title: string; kind: AssessmentKind; status: PublicationStatus; questions: number }[];
    activities: { id: string; title: string; instructions: string; stage: PracticeStage; competency: string; status: PublicationStatus; requiresValidation: boolean; isRequired: boolean; deliverable: "text" | "link" }[];
  }[];
  finalAssessments: { id: string; title: string; kind: AssessmentKind; status: PublicationStatus; questions: number }[];
  otherTracks: { id: string; title: string }[];
  jobTitles: { id: string; name: string }[];
}

type ModuleForm = { id?: string; code: string; title: string; description: string; objectives: string; requiresPrevious: boolean };
type ActivityForm = { id?: string; moduleId: string; title: string; instructions: string; stage: PracticeStage; competency: string; requiresValidation: boolean; isRequired: boolean; deliverable: "text" | "link" };

export function TrackEditorPage() {
  const { id = "" } = useParams();
  const url = `/api/admin/tracks/${id}`;
  const navigate = useNavigate();
  const toast = useToast();
  const { data, isLoading, error, refetch } = useApi<EditorData>(url);
  const [form, setForm] = useState<TrackFull | null>(null);
  const [mod, setMod] = useState<ModuleForm | null>(null);
  const [newContent, setNewContent] = useState<{ moduleId: string; type: ContentType; title: string } | null>(null);
  const [newAssessment, setNewAssessment] = useState<{ moduleId: string | null; title: string; kind: AssessmentKind } | null>(null);
  const [activity, setActivity] = useState<ActivityForm | null>(null);
  useDocumentTitle(data?.track.title);
  useEffect(() => {
    if (data) setForm(data.track);
  }, [data]);

  const inv = { invalidate: [url, "/api/admin/content", "/api/catalog", "/api/tracks"] };
  const save = useAction(
    () =>
      api.patch(url, {
        ...form,
        id: undefined,
        status: undefined,
        coverFileId: undefined,
        version: undefined,
        dependsOnTrackId: form!.mode === "dependente" ? form!.dependsOnTrackId : null,
        estimatedMinutesOverride: form!.estimatedMinutesOverride || null,
        rampDays: form!.isRampUp ? form!.rampDays || 7 : null,
      }),
    { ...inv, success: "Trilha salva." },
  );
  const status = useAction((v: { kind: "tracks" | "modules" | "contents" | "activities" | "assessments"; id: string; status: PublicationStatus }) => setStatus(v.kind, v.id, v.status), { ...inv, success: "Status atualizado." });
  const saveModule = useAction(() => (mod!.id ? api.patch(`/api/admin/modules/${mod!.id}`, { ...mod, id: undefined, code: mod!.code || null }) : api.post("/api/admin/modules", { ...mod, trackId: id, code: mod!.code || null })), {
    ...inv,
    success: "Módulo salvo.",
    onSuccess: () => setMod(null),
  });
  const reorderModules = useAction((ids: string[]) => api.post("/api/admin/modules/reorder", { ids }), inv);
  const del = useAction((v: { kind: string; id: string }) => api.del(`/api/admin/${v.kind}/${v.id}`), { ...inv, success: "Excluído." });
  const createContent = useAction(() => api.post<{ id: string }>("/api/admin/contents", newContent), { ...inv, onSuccess: (c) => navigate(`/admin/conteudos/${c.id}`) });
  const createAssessment = useAction(() => api.post<{ id: string }>("/api/admin/assessments", { ...newAssessment, trackId: id }), { ...inv, onSuccess: (a) => navigate(`/admin/avaliacoes/${a.id}`) });
  const saveActivity = useAction(
    () => (activity!.id ? api.patch(`/api/admin/activities/${activity!.id}`, { ...activity, id: undefined, moduleId: undefined }) : api.post("/api/admin/activities", activity)),
    { ...inv, success: "Atividade salva.", onSuccess: () => setActivity(null) },
  );

  if (isLoading || (data && !form)) return <PageLoader />;
  if (error instanceof ApiError && error.status === 404) return <NotFoundPage />;
  if (error || !data || !form) return <ErrorState error={error} retry={refetch} />;
  const { permissions: p } = data;
  const set = (patch: Partial<TrackFull>) => setForm({ ...form, ...patch });

  const uploadCover = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.upload(`${url}/cover`, fd);
      toast.success("Capa atualizada.");
      void refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <Link to="/admin/conteudos" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"><ArrowLeft className="h-4 w-4" aria-hidden /> Áreas e trilhas</Link>
      <PageHeader
        eyebrow={data.area.name}
        title={data.track.title}
        description={`Versão ${data.track.version} da trilha`}
        actions={
          <>
            <RevisionsButton entityType="track" entityId={id} />
            <Link to={`/trilhas/${id}`}><Button size="sm" variant="outline" icon={ExternalLink}>Ver como colaborador</Button></Link>
          </>
        }
      >
        <div className="mt-3">
          <StatusActions status={data.track.status} canEdit={p.canEdit} canPublish={p.canPublish} loading={status.isPending} onChange={(s) => status.mutate({ kind: "tracks", id, status: s })} />
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="Dados da trilha" action={p.canEdit && <Button size="sm" icon={Save} loading={save.isPending} onClick={() => save.mutate(undefined)}>Salvar</Button>} />
          <fieldset disabled={!p.canEdit} className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <Field label="Título" htmlFor="f-title" className="sm:col-span-2"><Input id="f-title" value={form.title} onChange={(e) => set({ title: e.target.value })} /></Field>
            <Field label="Resumo (cartão do catálogo)" htmlFor="f-summary" className="sm:col-span-2"><Input id="f-summary" value={form.summary} maxLength={400} onChange={(e) => set({ summary: e.target.value })} /></Field>
            <Field label="Apresentação" htmlFor="f-desc" className="sm:col-span-2"><Textarea id="f-desc" value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label="Objetivos" htmlFor="f-obj"><Textarea id="f-obj" value={form.objectives} onChange={(e) => set({ objectives: e.target.value })} /></Field>
            <Field label="Pré-requisitos (texto)" htmlFor="f-pre"><Textarea id="f-pre" value={form.prerequisitesText} onChange={(e) => set({ prerequisitesText: e.target.value })} /></Field>
            <Field label="Tipo de trilha" htmlFor="f-mode"><Select id="f-mode" value={form.mode} onChange={(e) => set({ mode: e.target.value as TrackMode })} options={TRACK_MODES.map((m) => ({ value: m, label: TRACK_MODE_LABEL[m] }))} /></Field>
            {form.mode === "dependente" ? (
              <Field label="Depende da conclusão de" htmlFor="f-dep"><Select id="f-dep" value={form.dependsOnTrackId ?? ""} onChange={(e) => set({ dependsOnTrackId: e.target.value || null })} placeholder="Selecione" options={data.otherTracks.map((t) => ({ value: t.id, label: t.title }))} /></Field>
            ) : (
              <Field label="Nível de dificuldade" htmlFor="f-level"><Select id="f-level" value={form.level} onChange={(e) => set({ level: e.target.value as Level })} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} /></Field>
            )}
            {form.mode === "dependente" && <Field label="Nível de dificuldade" htmlFor="f-level2"><Select id="f-level2" value={form.level} onChange={(e) => set({ level: e.target.value as Level })} options={LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))} /></Field>}
            <Field label="Especialidade" htmlFor="f-spec" hint="Usado no filtro do catálogo (ex.: Técnica, Comercial)."><Input id="f-spec" value={form.specialty} onChange={(e) => set({ specialty: e.target.value })} /></Field>
            <Field label="Carga horária estimada (min)" htmlFor="f-est" hint="Vazio = soma automática dos conteúdos."><Input id="f-est" type="number" min={1} value={form.estimatedMinutesOverride ?? ""} onChange={(e) => set({ estimatedMinutesOverride: e.target.value ? Number(e.target.value) : null })} /></Field>
            <Field label="Responsável pelo conteúdo" htmlFor="f-owner"><Input id="f-owner" value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} /></Field>
            <Field label="Sem autorização, no catálogo a trilha..." htmlFor="f-vis"><Select id="f-vis" value={form.lockedVisibility ?? ""} onChange={(e) => set({ lockedVisibility: (e.target.value || null) as TrackFull["lockedVisibility"] })} placeholder="Segue a configuração geral" options={[{ value: "locked", label: "Aparece bloqueada (pode solicitar acesso)" }, { value: "hidden", label: "Fica oculta" }]} /></Field>
            <fieldset className="space-y-1 sm:col-span-2">
              <legend className="mb-1 text-sm font-medium">Recomendada para os cargos</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {data.jobTitles.map((j) => (
                  <Checkbox key={j.id} label={j.name} checked={form.jobTitleIds.includes(j.id)} onChange={(v) => set({ jobTitleIds: v ? [...form.jobTitleIds, j.id] : form.jobTitleIds.filter((x) => x !== j.id) })} />
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2">
              <Checkbox label="Exige validação final do líder" checked={form.requiresLeaderValidation} onChange={(v) => set({ requiresLeaderValidation: v })} />
              <Checkbox label="Emite certificado na conclusão" checked={form.certificateEnabled} onChange={(v) => set({ certificateEnabled: v })} />
              <Checkbox label="Permite dúvidas e comentários" checked={form.commentsEnabled} onChange={(v) => set({ commentsEnabled: v })} />
              <Checkbox label="Trilha intensiva de rampagem" checked={form.isRampUp} onChange={(v) => set({ isRampUp: v, rampDays: v ? form.rampDays ?? 7 : null })} />
              {form.isRampUp && <Field label="Dias de rampagem" htmlFor="f-ramp"><Input id="f-ramp" type="number" min={1} max={90} value={form.rampDays ?? 7} onChange={(e) => set({ rampDays: Number(e.target.value) })} /></Field>}
            </div>
          </fieldset>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Capa" />
            <div className="space-y-3 p-5">
              {data.track.coverFileId ? (
                <img src={`/api/files/${data.track.coverFileId}/image`} alt="Capa da trilha" className="h-36 w-full rounded-xl object-cover" />
              ) : (
                <div className="h-36 rounded-xl" style={{ background: `linear-gradient(135deg, ${form.coverColor ?? data.area.color}, #050807)` }} aria-hidden />
              )}
              <Field label="Cor da capa" htmlFor="f-color"><Input id="f-color" type="color" disabled={!p.canEdit} value={form.coverColor ?? data.area.color} onChange={(e) => set({ coverColor: e.target.value })} className="h-11 p-1" /></Field>
              {p.canEdit && (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm hover:bg-subtle">
                  <ImageUp className="h-4 w-4" aria-hidden /> Enviar imagem (PNG, JPEG ou WebP)
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && void uploadCover(e.target.files[0])} />
                </label>
              )}
            </div>
          </Card>
          <Card className="p-5 text-sm text-muted">
            <p className="font-medium text-fg">Estrutura pedagógica</p>
            <p className="mt-1">Área → Trilha → Módulo → Conteúdo → Exercício → Avaliação → Aplicação prática. Use “Depende de etapa anterior” nos módulos para exigir a conclusão em sequência.</p>
          </Card>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">Módulos</h2>
          {p.canEdit && <Button size="sm" icon={Plus} onClick={() => setMod({ code: "", title: "", description: "", objectives: "", requiresPrevious: false })}>Novo módulo</Button>}
        </div>
        {data.modules.map((m, i) => (
          <Card key={m.id}>
            <div className="flex flex-wrap items-start gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="font-heading font-semibold">{m.code ? `${m.code} · ` : ""}{m.title}</p>
                <p className="text-xs text-muted">{m.requiresPrevious ? "Requer o módulo anterior" : "Livre na sequência"}</p>
              </div>
              <StatusActions status={m.status} canEdit={p.canEdit} canPublish={p.canPublish} onChange={(s) => status.mutate({ kind: "modules", id: m.id, status: s })} />
              {p.canEdit && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" icon={ArrowUp} aria-label="Mover módulo para cima" disabled={i === 0} onClick={() => { const ids = data.modules.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!]; reorderModules.mutate(ids); }} />
                  <Button size="icon" variant="ghost" icon={ArrowDown} aria-label="Mover módulo para baixo" disabled={i === data.modules.length - 1} onClick={() => { const ids = data.modules.map((x) => x.id); [ids[i + 1], ids[i]] = [ids[i]!, ids[i + 1]!]; reorderModules.mutate(ids); }} />
                  <Button size="icon" variant="ghost" icon={Pencil} aria-label="Editar módulo" onClick={() => setMod({ id: m.id, code: m.code ?? "", title: m.title, description: m.description, objectives: m.objectives, requiresPrevious: m.requiresPrevious })} />
                  {m.status === "draft" && p.canPublish && <ConfirmButton title="Excluir módulo?" message="O módulo e seus conteúdos em rascunho serão excluídos." onConfirm={() => del.mutateAsync({ kind: "modules", id: m.id })} variant="ghost" size="icon" icon={Trash2}><span className="sr-only">Excluir módulo</span></ConfirmButton>}
                </div>
              )}
            </div>
            <ul className="divide-y divide-border">
              {m.contents.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <FileText className="h-4 w-4 text-primary" aria-hidden />
                  <Link to={`/admin/conteudos/${c.id}`} className="min-w-0 flex-1 font-medium hover:text-primary">
                    {c.title}
                    <span className="block text-xs font-normal text-muted">
                      {CONTENT_TYPE_LABEL[c.type]}
                      {c.currentVersion ? ` · v${c.currentVersion.number} · ${c.currentVersion.pageCount} p.` : c.type === "document" ? " · sem arquivo" : ""}
                      {c.latestVersion && c.latestVersion.processingStatus !== "ready" ? ` · versão ${c.latestVersion.number}: ${c.latestVersion.processingStatus === "failed" ? "falhou" : "processando"}` : ""}
                      {!c.isRequired ? " · opcional" : ""}
                    </span>
                  </Link>
                  <Badge tone={statusTone(c.status)}>{c.status === "published" ? "Publicado" : c.status === "review" ? "Em revisão" : c.status === "archived" ? "Arquivado" : "Rascunho"}</Badge>
                </li>
              ))}
              {m.assessments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden />
                  <Link to={`/admin/avaliacoes/${a.id}`} className="min-w-0 flex-1 font-medium hover:text-primary">
                    {a.title}
                    <span className="block text-xs font-normal text-muted">{ASSESSMENT_KIND_LABEL[a.kind]} · {a.questions} questão(ões)</span>
                  </Link>
                  <Badge tone={statusTone(a.status)}>{a.status === "published" ? "Publicada" : a.status === "draft" ? "Rascunho" : a.status === "review" ? "Em revisão" : "Arquivada"}</Badge>
                </li>
              ))}
              {m.activities.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  {a.stage === "execute" ? <Hammer className="h-4 w-4 text-primary" aria-hidden /> : <Sparkles className="h-4 w-4 text-primary" aria-hidden />}
                  <button className="min-w-0 flex-1 text-left font-medium hover:text-primary" onClick={() => setActivity({ id: a.id, moduleId: m.id, title: a.title, instructions: a.instructions, stage: a.stage, competency: a.competency, requiresValidation: a.requiresValidation, isRequired: a.isRequired, deliverable: a.deliverable })} disabled={!p.canEdit}>
                    {a.title}
                    <span className="block text-xs font-normal text-muted">{PRACTICE_STAGE_LABEL[a.stage]}{a.requiresValidation ? " · validação do líder" : ""}</span>
                  </button>
                  <StatusActions status={a.status} canEdit={p.canEdit} canPublish={p.canPublish} onChange={(s) => status.mutate({ kind: "activities", id: a.id, status: s })} />
                </li>
              ))}
              {!m.contents.length && !m.assessments.length && !m.activities.length && <li className="px-5 py-3 text-sm text-muted">Módulo vazio.</li>}
            </ul>
            {p.canEdit && (
              <div className="flex flex-wrap gap-2 border-t border-border px-5 py-3">
                <Button size="sm" variant="outline" icon={Plus} onClick={() => setNewContent({ moduleId: m.id, type: "document", title: "" })}>Conteúdo</Button>
                <Button size="sm" variant="outline" icon={Plus} onClick={() => setNewAssessment({ moduleId: m.id, title: "", kind: "fixation" })}>Exercícios / avaliação</Button>
                <Button size="sm" variant="outline" icon={Plus} onClick={() => setActivity({ moduleId: m.id, title: "", instructions: "", stage: "demonstrate", competency: "", requiresValidation: true, isRequired: true, deliverable: "text" })}>Atividade prática</Button>
              </div>
            )}
          </Card>
        ))}
        {!data.modules.length && <Card className="p-6 text-sm text-muted">Nenhum módulo. Comece criando o primeiro módulo da trilha.</Card>}
        <Card>
          <CardHeader title="Avaliação final da trilha" action={p.canEdit && <Button size="sm" variant="outline" icon={Plus} onClick={() => setNewAssessment({ moduleId: null, title: "", kind: "final" })}>Avaliação final</Button>} />
          <ul className="divide-y divide-border p-2">
            {data.finalAssessments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Link to={`/admin/avaliacoes/${a.id}`} className="flex-1 font-medium hover:text-primary">{a.title} <span className="text-xs text-muted">· {ASSESSMENT_KIND_LABEL[a.kind]} · {a.questions} questão(ões)</span></Link>
                <Badge tone={statusTone(a.status)}>{a.status}</Badge>
              </li>
            ))}
            {!data.finalAssessments.length && <li className="px-3 py-2 text-sm text-muted">Sem avaliação final.</li>}
          </ul>
        </Card>
      </section>

      <Modal open={!!mod} onClose={() => setMod(null)} title={mod?.id ? "Editar módulo" : "Novo módulo"} footer={<><Button variant="ghost" onClick={() => setMod(null)}>Cancelar</Button><Button loading={saveModule.isPending} disabled={!mod?.title.trim()} onClick={() => saveModule.mutate(undefined)}>Salvar</Button></>}>
        {mod && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[120px_1fr]">
            <Field label="Código" htmlFor="m-code"><Input id="m-code" value={mod.code} placeholder="M1" onChange={(e) => setMod({ ...mod, code: e.target.value })} /></Field>
            <Field label="Título" htmlFor="m-title"><Input id="m-title" value={mod.title} onChange={(e) => setMod({ ...mod, title: e.target.value })} /></Field>
            <Field label="Descrição" htmlFor="m-desc" className="sm:col-span-2"><Textarea id="m-desc" value={mod.description} onChange={(e) => setMod({ ...mod, description: e.target.value })} /></Field>
            <Field label="Objetivos de aprendizagem" htmlFor="m-obj" className="sm:col-span-2"><Textarea id="m-obj" value={mod.objectives} onChange={(e) => setMod({ ...mod, objectives: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Checkbox label="Depende da conclusão do módulo anterior" description="Libera somente após concluir os conteúdos obrigatórios e passar nas avaliações exigidas do módulo anterior." checked={mod.requiresPrevious} onChange={(v) => setMod({ ...mod, requiresPrevious: v })} /></div>
          </div>
        )}
      </Modal>
      <Modal open={!!newContent} onClose={() => setNewContent(null)} title="Novo conteúdo" footer={<><Button variant="ghost" onClick={() => setNewContent(null)}>Cancelar</Button><Button loading={createContent.isPending} disabled={!newContent?.title.trim()} onClick={() => createContent.mutate(undefined)}>Criar e configurar</Button></>}>
        {newContent && (
          <div className="space-y-4">
            <Field label="Tipo" htmlFor="c-type" hint="Fase 1: apostilas em PDF (DOCX convertido). Vídeo, áudio e links já podem ser cadastrados."><Select id="c-type" value={newContent.type} onChange={(e) => setNewContent({ ...newContent, type: e.target.value as ContentType })} options={CONTENT_TYPES.map((t) => ({ value: t, label: CONTENT_TYPE_LABEL[t] }))} /></Field>
            <Field label="Título" htmlFor="c-title"><Input id="c-title" value={newContent.title} onChange={(e) => setNewContent({ ...newContent, title: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={!!newAssessment} onClose={() => setNewAssessment(null)} title={newAssessment?.moduleId ? "Nova avaliação do módulo" : "Nova avaliação final"} footer={<><Button variant="ghost" onClick={() => setNewAssessment(null)}>Cancelar</Button><Button loading={createAssessment.isPending} disabled={!newAssessment?.title.trim()} onClick={() => createAssessment.mutate(undefined)}>Criar e adicionar questões</Button></>}>
        {newAssessment && (
          <div className="space-y-4">
            <Field label="Título" htmlFor="as-title"><Input id="as-title" value={newAssessment.title} onChange={(e) => setNewAssessment({ ...newAssessment, title: e.target.value })} /></Field>
            <Field label="Tipo" htmlFor="as-kind"><Select id="as-kind" value={newAssessment.kind} onChange={(e) => setNewAssessment({ ...newAssessment, kind: e.target.value as AssessmentKind })} options={ASSESSMENT_KINDS.map((k) => ({ value: k, label: ASSESSMENT_KIND_LABEL[k] }))} /></Field>
          </div>
        )}
      </Modal>
      <Modal open={!!activity} onClose={() => setActivity(null)} title={activity?.id ? "Editar atividade prática" : "Nova atividade prática"} size="lg" footer={<>{activity?.id && p.canPublish && <ConfirmButton title="Excluir atividade?" message="Somente atividades em rascunho podem ser excluídas." onConfirm={async () => { await del.mutateAsync({ kind: "activities", id: activity.id! }); setActivity(null); }} icon={Trash2}>Excluir</ConfirmButton>}<Button variant="ghost" onClick={() => setActivity(null)}>Cancelar</Button><Button loading={saveActivity.isPending} disabled={!activity?.title.trim()} onClick={() => saveActivity.mutate(undefined)}>Salvar</Button></>}>
        {activity && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Título" htmlFor="ac-title" className="sm:col-span-2"><Input id="ac-title" value={activity.title} onChange={(e) => setActivity({ ...activity, title: e.target.value })} /></Field>
            <Field label="Etapa" htmlFor="ac-stage"><Select id="ac-stage" value={activity.stage} onChange={(e) => setActivity({ ...activity, stage: e.target.value as PracticeStage })} options={PRACTICE_STAGES.map((s) => ({ value: s, label: PRACTICE_STAGE_LABEL[s] }))} /></Field>
            <Field label="Competência avaliada" htmlFor="ac-comp"><Input id="ac-comp" value={activity.competency} onChange={(e) => setActivity({ ...activity, competency: e.target.value })} /></Field>
            <Field label="Instruções" htmlFor="ac-inst" className="sm:col-span-2"><Textarea id="ac-inst" value={activity.instructions} onChange={(e) => setActivity({ ...activity, instructions: e.target.value })} className="min-h-[140px]" /></Field>
            <Checkbox label="Exige validação do líder" checked={activity.requiresValidation} onChange={(v) => setActivity({ ...activity, requiresValidation: v })} />
            <Checkbox label="Obrigatória para concluir" checked={activity.isRequired} onChange={(v) => setActivity({ ...activity, isRequired: v })} />
          </div>
        )}
      </Modal>
    </div>
  );
}
