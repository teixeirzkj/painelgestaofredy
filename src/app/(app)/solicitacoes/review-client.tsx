"use client";
import { useState } from "react";
import { Check, X, PencilLine } from "lucide-react";
import { Button, Field, Textarea } from "@/components/ui";
import { ConfirmDialog, Modal } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { requestSaleEditAction, reviewEditRequestAction } from "@/app/actions";

export function ReviewButtons({ id }: { id: string }) {
  const { run } = useAction();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" onClick={() => setMode("approve")}>
        <Check className="h-3.5 w-3.5" /> Aprovar
      </Button>
      <Button size="sm" variant="outline" onClick={() => setMode("reject")}>
        <X className="h-3.5 w-3.5" /> Rejeitar
      </Button>
      <ConfirmDialog
        open={!!mode}
        onClose={() => setMode(null)}
        danger={mode === "reject"}
        title={mode === "approve" ? "Liberar edição da venda?" : "Rejeitar solicitação?"}
        description={mode === "approve" ? "O vendedor poderá alterar a venda uma vez. Depois da alteração, a venda volta para conferência." : "A venda continua travada para o vendedor."}
        confirmLabel={mode === "approve" ? "Aprovar" : "Rejeitar"}
        reason={{ label: "Observação (opcional)" }}
        onConfirm={async (note) => {
          await run(() => reviewEditRequestAction(id, mode === "approve", note), { onSuccess: () => setMode(null) });
        }}
      />
    </div>
  );
}

/** Botão usado na venda conferida, para quem não pode editar diretamente. */
export function RequestEditButton({ saleId }: { saleId: string }) {
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PencilLine className="h-4 w-4" /> Solicitar edição
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Solicitar edição"
        description="Esta venda já foi conferida pelo financeiro. Descreva o que precisa mudar; após a aprovação você poderá editar."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 5} onClick={() => run(() => requestSaleEditAction(saleId, reason), { onSuccess: () => (setOpen(false), setReason("")) })}>
              Enviar solicitação
            </Button>
          </>
        }
      >
        <Field label="O que precisa ser alterado" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Ex.: cliente trocou a data do hotel; valor da segunda parcela mudou" />
        </Field>
      </Modal>
    </>
  );
}
