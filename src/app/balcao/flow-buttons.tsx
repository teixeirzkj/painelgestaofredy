"use client";
import { useRouter } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { attachBalcaoSaleAction, discardBalcaoFlowAction, markBalcaoFlowAction, prepareContractAction } from "@/app/actions";

/** Confirma a etapa e segue para a próxima (a página recarrega já na etapa seguinte). */
export function FlowMarkButton({ id, mark, label, disabled, variant = "primary" }: { id: string; mark: "data" | "docs" | "sent" | "finish"; label: string; disabled?: boolean; variant?: "primary" | "outline" }) {
  const router = useRouter();
  const { run, busy } = useAction();
  return (
    <Button
      size="lg"
      variant={variant}
      loading={busy}
      disabled={disabled}
      onClick={() => run(() => markBalcaoFlowAction(id, mark), { success: false, refresh: false, onSuccess: () => router.replace(`/balcao/a/${id}`) }).then(() => router.refresh())}
    >
      {label} <ArrowRight className="h-4 w-4" />
    </Button>
  );
}

/** Continua por um rascunho que já existe (ex.: o que chegou do Frédy quando o card virou ganho). */
export function AttachDraftButton({ flowId, saleId, label }: { flowId: string; saleId: string; label: string }) {
  const { run, busy } = useAction();
  return (
    <Button size="sm" variant="outline" loading={busy} onClick={() => run(() => attachBalcaoSaleAction(flowId, saleId))}>
      {label}
    </Button>
  );
}

/** Tira o atendimento da lista (cliente e venda continuam na gestão). */
export function DiscardFlowButton({ id, to, label, confirmText }: { id: string; to?: string; label?: string; confirmText: string }) {
  const router = useRouter();
  const { run, busy } = useAction();
  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted hover:bg-slate-100 hover:text-ink disabled:opacity-50"
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        run(() => discardBalcaoFlowAction(id), { success: label ? false : undefined, onSuccess: () => to && router.push(to) });
      }}
    >
      {label ?? (
        <>
          <X className="h-3.5 w-3.5" /> Remover
        </>
      )}
    </button>
  );
}

/** Gera o contrato da venda confirmada quando ele ainda não existe. */
export function PrepareContractButton({ saleId }: { saleId: string }) {
  const { run, busy } = useAction();
  return (
    <Button loading={busy} onClick={() => run(() => prepareContractAction(saleId))}>
      Gerar o contrato
    </Button>
  );
}
