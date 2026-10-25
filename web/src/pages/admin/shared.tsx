import { useState } from "react";
import { Archive, Eye, History, RotateCcw, Send, Upload } from "lucide-react";
import { PUBLICATION_STATUS_LABEL, type PublicationStatus } from "../../../../shared/domain";
import { Badge, Button, Modal, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useApi } from "../../lib/hooks";
import { statusTone } from "./ContentTree";

/** Ações do fluxo editorial: rascunho → revisão → publicado → arquivado. */
export function StatusActions({ status, onChange, canEdit, canPublish, loading }: { status: PublicationStatus; onChange: (s: PublicationStatus) => void; canEdit: boolean; canPublish: boolean; loading?: boolean }) {
  if (!canEdit) return <Badge tone={statusTone(status)}>{PUBLICATION_STATUS_LABEL[status]}</Badge>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={statusTone(status)}>{PUBLICATION_STATUS_LABEL[status]}</Badge>
      {status === "draft" && (
        <Button size="sm" variant="outline" icon={Send} disabled={loading} onClick={() => onChange("review")}>
          Enviar para revisão
        </Button>
      )}
      {(status === "draft" || status === "review") && canPublish && (
        <Button size="sm" icon={Upload} disabled={loading} onClick={() => onChange("published")}>
          Publicar
        </Button>
      )}
      {status === "review" && (
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => onChange("draft")}>
          Voltar para rascunho
        </Button>
      )}
      {status === "published" && canPublish && (
        <>
          <Button size="sm" variant="outline" icon={Eye} disabled={loading} onClick={() => onChange("draft")}>
            Despublicar
          </Button>
          <Button size="sm" variant="ghost" icon={Archive} disabled={loading} onClick={() => onChange("archived")}>
            Arquivar
          </Button>
        </>
      )}
      {status === "archived" && canPublish && (
        <Button size="sm" variant="outline" icon={RotateCcw} disabled={loading} onClick={() => onChange("draft")}>
          Restaurar como rascunho
        </Button>
      )}
      {!canPublish && status !== "published" && <span className="text-xs text-muted">A publicação depende de autorização do administrador.</span>}
    </div>
  );
}

interface Revision {
  id: string;
  action: string;
  changedAt: string;
  author: string | null;
  snapshot: Record<string, unknown>;
}

const ACTION_LABEL: Record<string, string> = { created: "Criado", updated: "Alterado" };

export function RevisionsButton({ entityType, entityId }: { entityType: string; entityId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useApi<Revision[]>(open ? `/api/admin/revisions?entityType=${entityType}&entityId=${entityId}` : null);
  return (
    <>
      <Button size="sm" variant="ghost" icon={History} onClick={() => setOpen(true)}>
        Histórico
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Histórico de alterações" size="lg">
        {isLoading ? (
          <Spinner />
        ) : !data?.length ? (
          <p className="text-sm text-muted">Sem alterações registradas.</p>
        ) : (
          <ol className="space-y-3">
            {data.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-3 text-sm">
                <p className="font-medium">
                  {r.action.startsWith("status:") ? `Status: ${PUBLICATION_STATUS_LABEL[r.action.slice(7) as PublicationStatus] ?? r.action.slice(7)}` : r.action.startsWith("version:") ? `Versão ${r.action.slice(8)} ativada` : ACTION_LABEL[r.action] ?? r.action}
                </p>
                <p className="text-xs text-muted">
                  {formatDateTime(r.changedAt)} · {r.author ?? "sistema"}
                </p>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-primary">Ver dados registrados</summary>
                  <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-subtle p-2 text-[11px]">{JSON.stringify(r.snapshot, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ol>
        )}
      </Modal>
    </>
  );
}

export async function setStatus(kind: "tracks" | "modules" | "contents" | "activities" | "assessments", id: string, status: PublicationStatus) {
  return api.post(`/api/admin/${kind}/${id}/status`, { status });
}
