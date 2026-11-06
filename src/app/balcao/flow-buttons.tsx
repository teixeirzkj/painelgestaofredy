"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Send, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { attachBalcaoSaleAction, discardBalcaoFlowAction, markBalcaoFlowAction, prepareContractAction, sendBalcaoContractAction } from "@/app/actions";

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

/** Manda o PDF do contrato na conversa aberta do cliente no Frédy; deu certo, a tela vai para a etapa 7. */
export function SendViaFredyButton({ id }: { id: string }) {
  const router = useRouter();
  const { run, busy } = useAction();
  return (
    <Button
      size="lg"
      loading={busy}
      className="bg-emerald-600 shadow-emerald-600/25 hover:bg-emerald-700"
      onClick={() => run(() => sendBalcaoContractAction(id), { refresh: false, onSuccess: () => router.replace(`/balcao/a/${id}`) }).then(() => router.refresh())}
    >
      <Send className="h-4 w-4" /> Enviar contrato pelo Frédy
    </Button>
  );
}

/**
 * Atendimento concluído: depois de 5 segundos fecha a janela e devolve o atendente ao Frédy.
 * Se a tela estiver embutida no Frédy (não dá para fechar daqui), avisa a página do Frédy e mostra que pode fechar.
 */
export function AutoClose({ seconds = 5, saleCode }: { seconds?: number; saleCode: string | null }) {
  const [left, setLeft] = useState(seconds);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (left <= 0) {
      const msg = { source: "fredy-gestao", type: "atendimento.concluido", saleCode };
      try {
        window.opener?.postMessage(msg, "*");
        if (window.parent !== window) window.parent.postMessage(msg, "*");
      } catch {}
      window.close();
      const t = setTimeout(() => setStuck(true), 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, saleCode]);
  if (stuck) return <p className="text-sm font-medium text-emerald-700">Pronto! Pode fechar esta janela e voltar para o Frédy.</p>;
  return (
    <p className="text-sm text-muted" aria-live="polite">
      Voltando para o Frédy em <span className="tabular font-semibold text-ink">{left}</span> s…
    </p>
  );
}
