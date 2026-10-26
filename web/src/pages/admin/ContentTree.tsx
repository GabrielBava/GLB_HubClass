import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus } from "lucide-react";
import { PUBLICATION_STATUS_LABEL, TRACK_MODE_LABEL, type PublicationStatus, type TrackMode } from "../../../../shared/domain";
import { AREA_ICONS, AreaIcon } from "../../components/AreaIcon";
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";

interface TreeArea {
  id: string;
  slug: string;
  code: string | null;
  name: string;
  description: string;
  icon: string;
  color: string;
  isVisible: boolean;
  sortOrder: number;
  settings: { wordsPerMinute?: number; passingScore?: number; commentsEnabled?: boolean };
  canEdit: boolean;
  canPublish: boolean;
  tracks: { id: string; title: string; status: PublicationStatus; mode: TrackMode; level: string; modules: number; enrollments: number; updatedAt: string }[];
}

export const statusTone = (s: PublicationStatus) => (s === "published" ? "success" : s === "review" ? "info" : s === "archived" ? "neutral" : "warning") as "success" | "info" | "neutral" | "warning";

interface AreaForm {
  id?: string;
  name: string;
  code: string;
  description: string;
  icon: string;
  color: string;
  isVisible: boolean;
  wpm: string;
  passingScore: string;
  commentsEnabled: boolean;
}

export function ContentTreePage() {
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useApi<TreeArea[]>("/api/admin/content/tree");
  const [area, setArea] = useState<AreaForm | null>(null);
  const [newTrack, setNewTrack] = useState<{ areaId: string; title: string } | null>(null);
  useDocumentTitle("Áreas e trilhas");
  const inv = { invalidate: ["/api/admin/content", "/api/catalog", "/api/areas"] };
  const saveArea = useAction(
    () => {
      const body = {
        name: area!.name,
        code: area!.code || null,
        description: area!.description,
        icon: area!.icon,
        color: area!.color,
        isVisible: area!.isVisible,
        settings: {
          ...(area!.wpm ? { wordsPerMinute: Number(area!.wpm) } : {}),
          ...(area!.passingScore ? { passingScore: Number(area!.passingScore) } : {}),
          commentsEnabled: area!.commentsEnabled,
        },
      };
      return area!.id ? api.patch(`/api/admin/areas/${area!.id}`, body) : api.post("/api/admin/areas", body);
    },
    { ...inv, success: "Área salva.", onSuccess: () => setArea(null) },
  );
  const toggleVisible = useAction((a: TreeArea) => api.patch(`/api/admin/areas/${a.id}`, { isVisible: !a.isVisible }), { ...inv, success: "Visibilidade atualizada." });
  const reorder = useAction((ids: string[]) => api.post("/api/admin/areas/reorder", { ids }), inv);
  const reorderTracks = useAction((ids: string[]) => api.post("/api/admin/tracks/reorder", { ids }), inv);
  const createTrack = useAction(() => api.post<{ id: string }>("/api/admin/tracks", newTrack), { ...inv, success: "Trilha criada como rascunho.", onSuccess: (t) => navigate(`/admin/trilhas/${t.id}`) });

  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const move = <T,>(list: T[], i: number, dir: -1 | 1) => {
    const next = [...list];
    const j = i + dir;
    if (j < 0 || j >= next.length) return list;
    [next[i], next[j]] = [next[j]!, next[i]!];
    return next;
  };
  const editable = data.filter((a) => a.canEdit);

  return (
    <div>
      <PageHeader
        title="Áreas e trilhas"
        description="Crie, edite, oculte e reorganize áreas, trilhas, módulos e conteúdos sem alterar código. Conteúdos passam por rascunho, revisão, publicação e arquivamento."
        actions={
          <>
            {isAdmin && (
              <Button variant="outline" icon={Plus} onClick={() => setArea({ name: "", code: "", description: "", icon: "BookOpen", color: "#F36B22", isVisible: true, wpm: "", passingScore: "", commentsEnabled: true })}>
                Nova área
              </Button>
            )}
            {editable.length > 0 && <Button icon={Plus} onClick={() => setNewTrack({ areaId: editable[0]!.id, title: "" })}>Nova trilha</Button>}
          </>
        }
      />
      {data.length === 0 && <EmptyState title="Nenhuma área sob sua responsabilidade" />}
      <div className="space-y-5">
        {data.map((a, i) => (
          <Card key={a.id} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <span className="grid h-10 w-10 place-items-center rounded-xl text-white" style={{ background: a.color }}>
                <AreaIcon name={a.icon} className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-heading font-semibold">
                  {a.code && <span className="text-muted">{a.code}.</span>} {a.name}
                  {!a.isVisible && <Badge>Oculta</Badge>}
                </p>
                <p className="text-xs text-muted">{a.tracks.length} trilha(s){a.settings.wordsPerMinute ? ` · ${a.settings.wordsPerMinute} palavras/min` : ""}{a.settings.passingScore ? ` · nota mínima ${a.settings.passingScore}%` : ""}</p>
              </div>
              {isAdmin && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" icon={ArrowUp} aria-label="Mover área para cima" disabled={i === 0} onClick={() => reorder.mutate(move(data, i, -1).map((x) => x.id))} />
                  <Button size="icon" variant="ghost" icon={ArrowDown} aria-label="Mover área para baixo" disabled={i === data.length - 1} onClick={() => reorder.mutate(move(data, i, 1).map((x) => x.id))} />
                  <Button size="icon" variant="ghost" icon={a.isVisible ? EyeOff : Eye} aria-label={a.isVisible ? "Ocultar área" : "Mostrar área"} onClick={() => toggleVisible.mutate(a)} />
                  <Button
                    size="icon"
                    variant="ghost"
                    icon={Pencil}
                    aria-label="Editar área"
                    onClick={() =>
                      setArea({
                        id: a.id,
                        name: a.name,
                        code: a.code ?? "",
                        description: a.description,
                        icon: a.icon,
                        color: a.color,
                        isVisible: a.isVisible,
                        wpm: a.settings.wordsPerMinute ? String(a.settings.wordsPerMinute) : "",
                        passingScore: a.settings.passingScore ? String(a.settings.passingScore) : "",
                        commentsEnabled: a.settings.commentsEnabled ?? true,
                      })
                    }
                  />
                </div>
              )}
            </div>
            {a.tracks.length ? (
              <ul className="divide-y divide-border">
                {a.tracks.map((t, j) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Link to={`/admin/trilhas/${t.id}`} className="min-w-0 flex-1 font-medium hover:text-primary">
                      {t.title}
                      <span className="block text-xs font-normal text-muted">
                        {TRACK_MODE_LABEL[t.mode]} · {t.modules} módulo(s) · {t.enrollments} matrícula(s) · atualizada {formatDate(t.updatedAt)}
                      </span>
                    </Link>
                    <Badge tone={statusTone(t.status)}>{PUBLICATION_STATUS_LABEL[t.status]}</Badge>
                    {a.canEdit && (
                      <span className="flex gap-1">
                        <Button size="icon" variant="ghost" icon={ArrowUp} aria-label="Mover trilha para cima" disabled={j === 0} onClick={() => reorderTracks.mutate(move(a.tracks, j, -1).map((x) => x.id))} />
                        <Button size="icon" variant="ghost" icon={ArrowDown} aria-label="Mover trilha para baixo" disabled={j === a.tracks.length - 1} onClick={() => reorderTracks.mutate(move(a.tracks, j, 1).map((x) => x.id))} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">Nenhuma trilha nesta área.</p>
            )}
          </Card>
        ))}
      </div>

      <Modal
        open={!!area}
        onClose={() => setArea(null)}
        title={area?.id ? "Editar área" : "Nova área"}
        size="lg"
        footer={<><Button variant="ghost" onClick={() => setArea(null)}>Cancelar</Button><Button loading={saveArea.isPending} disabled={!area?.name.trim()} onClick={() => saveArea.mutate(undefined)}>Salvar</Button></>}
      >
        {area && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="a-name" required className="sm:col-span-2"><Input id="a-name" value={area.name} onChange={(e) => setArea({ ...area, name: e.target.value })} /></Field>
            <Field label="Código (ex.: A, B)" htmlFor="a-code"><Input id="a-code" value={area.code} maxLength={10} onChange={(e) => setArea({ ...area, code: e.target.value })} /></Field>
            <Field label="Ícone" htmlFor="a-icon"><Select id="a-icon" value={area.icon} onChange={(e) => setArea({ ...area, icon: e.target.value })} options={Object.keys(AREA_ICONS).map((k) => ({ value: k, label: k }))} /></Field>
            <Field label="Descrição" htmlFor="a-desc" className="sm:col-span-2"><Textarea id="a-desc" value={area.description} onChange={(e) => setArea({ ...area, description: e.target.value })} /></Field>
            <Field label="Cor" htmlFor="a-color"><Input id="a-color" type="color" value={area.color} onChange={(e) => setArea({ ...area, color: e.target.value })} className="h-11 p-1" /></Field>
            <div className="pt-7"><Checkbox label="Área visível no catálogo" checked={area.isVisible} onChange={(v) => setArea({ ...area, isVisible: v })} /></div>
            <Field label="Palavras por minuto (desta área)" htmlFor="a-wpm" hint="Vazio = padrão da plataforma."><Input id="a-wpm" type="number" min={80} max={600} value={area.wpm} onChange={(e) => setArea({ ...area, wpm: e.target.value })} /></Field>
            <Field label="Nota mínima padrão (%)" htmlFor="a-pass" hint="Vazio = padrão da plataforma."><Input id="a-pass" type="number" min={0} max={100} value={area.passingScore} onChange={(e) => setArea({ ...area, passingScore: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Checkbox label="Permitir dúvidas e comentários compartilhados" checked={area.commentsEnabled} onChange={(v) => setArea({ ...area, commentsEnabled: v })} /></div>
          </div>
        )}
      </Modal>
      <Modal
        open={!!newTrack}
        onClose={() => setNewTrack(null)}
        title="Nova trilha"
        description="A trilha nasce como rascunho. Depois, adicione módulos, conteúdos e avaliações."
        footer={<><Button variant="ghost" onClick={() => setNewTrack(null)}>Cancelar</Button><Button loading={createTrack.isPending} disabled={!newTrack?.title.trim()} onClick={() => createTrack.mutate(undefined)}>Criar</Button></>}
      >
        {newTrack && (
          <div className="space-y-4">
            <Field label="Área" htmlFor="t-area"><Select id="t-area" value={newTrack.areaId} onChange={(e) => setNewTrack({ ...newTrack, areaId: e.target.value })} options={editable.map((a) => ({ value: a.id, label: a.name }))} /></Field>
            <Field label="Título" htmlFor="t-title"><Input id="t-title" value={newTrack.title} onChange={(e) => setNewTrack({ ...newTrack, title: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
