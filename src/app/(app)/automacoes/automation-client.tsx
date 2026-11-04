"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Play, Code2 } from "lucide-react";
import { Button } from "@/components/ui";
import { Modal } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { runAutomationsAction, setAutomationAction } from "@/app/actions";
import { cn } from "@/lib/utils";

export function AutomationToggle({ k, enabled }: { k: string; enabled: boolean }) {
  const { run, busy } = useAction();
  return (
    <button
      role="switch"
      aria-checked={enabled}
      disabled={busy}
      onClick={() => run(() => setAutomationAction(k, !enabled))}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", enabled ? "bg-brand-600" : "bg-slate-300")}
    >
      <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", enabled ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

export function RunNowButton() {
  const { run, busy } = useAction();
  return (
    <Button
      variant="outline"
      loading={busy}
      onClick={() =>
        run(() => runAutomationsAction(), {
          success: false,
          onSuccess: (r) =>
            toast.success(
              `Verificação concluída: ${r.vencendo} lembrete(s), ${r.viagemProxima} viagem(ns) próxima(s), ${r.concluidas} viagem(ns) concluída(s).` +
                (r.dispatch.skipped ? " Sem destino configurado para entrega." : ` Entregues: ${r.dispatch.delivered}, falhas: ${r.dispatch.failed}.`),
            ),
        })
      }
    >
      <Play className="h-4 w-4" /> Executar verificação agora
    </Button>
  );
}

export function PayloadButton({ payload }: { payload: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Code2 className="h-4 w-4" /> Dados
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Conteúdo do evento" size="lg">
        <pre className="overflow-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">{JSON.stringify(JSON.parse(payload), null, 2)}</pre>
      </Modal>
    </>
  );
}
