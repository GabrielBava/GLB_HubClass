import { useState } from "react";
import { Link } from "react-router";
import { Inbox, MessagesSquare, Send } from "lucide-react";
import { REQUEST_STATUS_LABEL, REQUEST_TYPE_LABEL, type RequestStatus, type RequestType } from "../../../../shared/domain";
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, PageLoader, Select, Tabs, Textarea } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDateTime, relativeTime } from "../../lib/format";
import { useAction, useApi, useDocumentTitle } from "../../lib/hooks";

interface RequestItem {
  id: string;
  type: RequestType;
  status: RequestStatus;
  userName: string;
  title: string;
  trackId: string | null;
  areaName: string | null;
  message: string;
  resolutionNote: string | null;
  createdAt: string;
}

function RequestCard({ r }: { r: RequestItem }) {
  const [note, setNote] = useState("");
  const resolve = useAction((decision: "approved" | "rejected" | "closed") => api.post(`/api/leader/requests/${r.id}/resolve`, { decision, note }), {
    invalidate: ["/api/leader/requests"],
    success: "Solicitação respondida.",
  });
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Badge tone="primary">{REQUEST_TYPE_LABEL[r.type]}</Badge>
          <p className="mt-1 font-medium">{r.title || "—"}</p>
          <p className="text-xs text-muted">{r.userName} · {r.areaName ?? "sem área"} · {formatDateTime(r.createdAt)}</p>
        </div>
        <Badge tone={r.status === "open" ? "warning" : r.status === "approved" ? "success" : "neutral"}>{REQUEST_STATUS_LABEL[r.status]}</Badge>
      </div>
      {r.message && <p className="mt-2 whitespace-pre-line text-sm">{r.message}</p>}
      {r.resolutionNote && <p className="mt-2 text-sm text-muted">Resposta: {r.resolutionNote}</p>}
      {r.status === "open" && (
        <div className="mt-3 space-y-2">
          <Input aria-label="Resposta" placeholder="Resposta ao colaborador (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {r.type === "access" ? (
              <>
                <Button size="sm" loading={resolve.isPending} onClick={() => resolve.mutate("approved")}>Aprovar e liberar acesso</Button>
                <Button size="sm" variant="outline" onClick={() => resolve.mutate("rejected")}>Recusar</Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => resolve.mutate("approved")}>Aceitar sugestão</Button>
                <Button size="sm" variant="outline" onClick={() => resolve.mutate("closed")}>Encerrar</Button>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function RequestsPage() {
  const { data, isLoading, error, refetch } = useApi<RequestItem[]>("/api/leader/requests");
  const areas = useApi<{ id: string; name: string }[]>("/api/areas/simple");
  const [tab, setTab] = useState<"open" | "done">("open");
  const [form, setForm] = useState<{ open: boolean; type: "content_suggestion" | "content_creation"; areaId: string; title: string; message: string }>({ open: false, type: "content_creation", areaId: "", title: "", message: "" });
  useDocumentTitle("Solicitações");
  const create = useAction(() => api.post("/api/requests", { type: form.type, areaId: form.areaId || undefined, title: form.title, message: form.message }), {
    invalidate: ["/api/leader/requests"],
    success: "Pedido enviado ao administrador.",
    onSuccess: () => setForm({ ...form, open: false, title: "", message: "" }),
  });
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const list = data.filter((r) => (tab === "open" ? r.status === "open" : r.status !== "open"));
  return (
    <div>
      <PageHeader
        title="Solicitações"
        description="Pedidos de acesso dos colaboradores e sugestões de conteúdo das suas áreas."
        actions={<Button icon={Send} onClick={() => setForm({ ...form, open: true })}>Solicitar elaboração de conteúdo</Button>}
      />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: "open", label: "Abertas", count: data.filter((r) => r.status === "open").length }, { id: "done", label: "Respondidas" }]} />
      {list.length ? <div className="space-y-3">{list.map((r) => <RequestCard key={r.id} r={r} />)}</div> : <EmptyState icon={Inbox} title="Nenhuma solicitação" />}
      <Modal
        open={form.open}
        onClose={() => setForm({ ...form, open: false })}
        title="Novo pedido de conteúdo"
        footer={<><Button variant="ghost" onClick={() => setForm({ ...form, open: false })}>Cancelar</Button><Button loading={create.isPending} disabled={!form.title.trim()} onClick={() => create.mutate(undefined)}>Enviar</Button></>}
      >
        <div className="space-y-4">
          <Field label="Tipo" htmlFor="rq-type"><Select id="rq-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })} options={[{ value: "content_creation", label: REQUEST_TYPE_LABEL.content_creation }, { value: "content_suggestion", label: REQUEST_TYPE_LABEL.content_suggestion }]} /></Field>
          <Field label="Área" htmlFor="rq-area"><Select id="rq-area" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })} placeholder="Selecione" options={(areas.data ?? []).map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <Field label="Título" htmlFor="rq-title"><Input id="rq-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: apostila sobre consórcio de veículos pesados" /></Field>
          <Field label="Detalhes" htmlFor="rq-msg"><Textarea id="rq-msg" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  );
}

interface Question {
  id: string;
  contentId: string;
  contentTitle: string;
  trackTitle: string;
  author: string;
  body: string;
  page: number | null;
  createdAt: string;
  replies: number;
}

export function LeaderQuestionsPage() {
  const { data, isLoading, error, refetch } = useApi<Question[]>("/api/leader/questions");
  useDocumentTitle("Dúvidas das trilhas");
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  return (
    <div>
      <PageHeader title="Dúvidas das trilhas" description="Perguntas publicadas pelos colaboradores nos conteúdos das suas áreas. Responda diretamente no leitor." />
      {!data.length ? (
        <EmptyState icon={MessagesSquare} title="Nenhuma dúvida publicada" />
      ) : (
        <Card className="divide-y divide-border">
          {data.map((q) => (
            <div key={q.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted">{q.trackTitle} · {q.contentTitle}{q.page ? ` · p. ${q.page}` : ""}</p>
                <p className="mt-1 whitespace-pre-line">{q.body}</p>
                <p className="mt-1 text-xs text-muted">{q.author} · {relativeTime(q.createdAt)} · {q.replies} resposta(s)</p>
              </div>
              <Link to={`/conteudos/${q.contentId}?painel=comentarios${q.page ? `&pagina=${q.page}` : ""}`}>
                <Button size="sm" variant={q.replies ? "outline" : "primary"}>{q.replies ? "Ver conversa" : "Responder"}</Button>
              </Link>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
