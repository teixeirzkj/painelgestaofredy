"use client";
import { useState } from "react";
import { RefreshCw, FileCheck2, Printer, Ban, RotateCcw, Send, Link2, SearchCheck, Split } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { ConfirmDialog, Modal } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { cancelContractAction, checkContractSignatureAction, issueContractAction, refreshContractAction, reopenContractAction, sendContractToSignatureAction, splitTripContractAction } from "@/app/actions";

type Signature = { enabled: boolean; provider: string | null; signUrl: string | null; cost: string; clientEmail: string | null; clientPhone: string | null };

export function ContractActions({ id, status, canIssue, canSplit = false, signature }: { id: string; status: string; canIssue: boolean; /** contrato da viagem ainda não enviado */ canSplit?: boolean; signature: Signature }) {
  const { run, busy } = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmSplit, setConfirmSplit] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [opts, setOpts] = useState({ whatsapp: !signature.clientEmail, signAgency: true });
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
      {canSplit && (
        <Button variant="ghost" onClick={() => setConfirmSplit(true)}>
          <Split className="h-4 w-4" /> Separar em contratos por venda
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
      {status === "ENVIADO" && signature.provider === "ZAPSIGN" && (
        <>
          {signature.signUrl && (
            <Button variant="outline" onClick={() => navigator.clipboard.writeText(signature.signUrl!).then(() => toast.success("Link de assinatura copiado. Envie ao cliente pelo WhatsApp."))}>
              <Link2 className="h-4 w-4" /> Copiar link de assinatura
            </Button>
          )}
          <Button
            variant="outline"
            loading={busy}
            onClick={() => run(() => checkContractSignatureAction(id), { success: false, onSuccess: (d) => (d.signed ? toast.success("Contrato assinado!") : toast.info("Ainda aguardando assinatura.")) })}
          >
            <SearchCheck className="h-4 w-4" /> Consultar status
          </Button>
        </>
      )}
      {status === "AGUARDANDO_ENVIO" && (
        <Button
          disabled={!signature.enabled}
          title={signature.enabled ? undefined : "A assinatura online fica disponível quando a ZapSign for configurada na plataforma"}
          onClick={() => setSendOpen(true)}
        >
          <Send className="h-4 w-4" /> Enviar para assinatura
        </Button>
      )}
      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Enviar para assinatura online"
        description={`Pela ZapSign. Custo de ${signature.cost} por envio, lançado em contas a pagar (Sistemas).`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSendOpen(false)}>
              Cancelar
            </Button>
            <Button loading={busy} onClick={() => run(() => sendContractToSignatureAction(id, opts), { onSuccess: () => setSendOpen(false) })}>
              <Send className="h-4 w-4" /> Enviar
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            O cliente recebe o link {signature.clientEmail ? <>por e-mail (<strong>{signature.clientEmail}</strong>)</> : <span className="text-warning">sem e-mail cadastrado</span>}
            {opts.whatsapp && signature.clientPhone ? " e por WhatsApp" : ""}. Você também pode copiar o link depois e mandar pelo WhatsApp da agência.
          </p>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={opts.whatsapp} disabled={!signature.clientPhone} onChange={(e) => setOpts({ ...opts, whatsapp: e.target.checked })} />
            Enviar também pelo WhatsApp da ZapSign {signature.clientPhone ? "" : "(cliente sem WhatsApp)"}
          </label>
          <label className="flex items-center gap-2.5">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={opts.signAgency} onChange={(e) => setOpts({ ...opts, signAgency: e.target.checked })} />
            A agência também assina (responsável e e-mail da agência em Configurações)
          </label>
          <p className="text-xs text-muted">O contrato só passa para “Assinado” quando a ZapSign confirmar todas as assinaturas.</p>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmSplit}
        onClose={() => setConfirmSplit(false)}
        danger={false}
        title="Separar em contratos por venda?"
        description="O contrato da viagem vai virar um contrato para cada venda. Continuar?"
        confirmLabel="Separar"
        onConfirm={async () => {
          await run(() => splitTripContractAction(id), { onSuccess: () => setConfirmSplit(false) });
        }}
      />
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
