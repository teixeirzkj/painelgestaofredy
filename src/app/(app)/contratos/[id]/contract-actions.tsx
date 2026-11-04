"use client";
import { useState } from "react";
import { RefreshCw, FileCheck2, Printer, Ban, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { cancelContractAction, issueContractAction, refreshContractAction, reopenContractAction } from "@/app/actions";

export function ContractActions({ id, status, canIssue }: { id: string; status: string; canIssue: boolean }) {
  const { run, busy } = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const preparing = status === "EM_PREPARACAO" || status === "NAO_GERADO";
  return (
    <>
      {(preparing || status === "AGUARDANDO_ENVIO") && (
        <Button variant="outline" loading={busy} onClick={() => run(() => refreshContractAction(id))}>
          <RefreshCw className="h-4 w-4" /> Atualizar prévia
        </Button>
      )}
      {status === "CANCELADO" && (
        <Button variant="outline" loading={busy} onClick={() => run(() => reopenContractAction(id))}>
          <RotateCcw className="h-4 w-4" /> Reabrir (nova versão)
        </Button>
      )}
      {status !== "CANCELADO" && status !== "ASSINADO" && (
        <Button variant="ghost" className="text-danger" onClick={() => setConfirmCancel(true)}>
          <Ban className="h-4 w-4" /> Cancelar
        </Button>
      )}
      <Button variant="outline" onClick={() => window.print()} disabled={status === "NAO_GERADO"}>
        <Printer className="h-4 w-4" /> Imprimir / salvar PDF
      </Button>
      {preparing && (
        <Button loading={busy} disabled={!canIssue} title={canIssue ? undefined : "Complete os dados pendentes"} onClick={() => run(() => issueContractAction(id))}>
          <FileCheck2 className="h-4 w-4" /> Emitir contrato
        </Button>
      )}
      {status === "AGUARDANDO_ENVIO" && (
        <Button disabled title="Configure um provedor de assinatura eletrônica para habilitar o envio">
          <Send className="h-4 w-4" /> Enviar para assinatura
        </Button>
      )}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Cancelar contrato?"
        description="O contrato deixará de ser válido. Você poderá reabri-lo depois para emitir uma nova versão."
        confirmLabel="Cancelar contrato"
        onConfirm={async () => {
          await run(() => cancelContractAction(id), { onSuccess: () => setConfirmCancel(false) });
        }}
      />
    </>
  );
}
