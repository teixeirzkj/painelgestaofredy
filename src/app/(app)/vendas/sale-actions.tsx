"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Copy, Ban, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { cancelSaleAction, duplicateSaleAction } from "@/app/actions";

export function useSaleOps(id: string) {
  const router = useRouter();
  const { run, busy } = useAction();
  return {
    busy,
    duplicate: () => run(() => duplicateSaleAction(id), { onSuccess: (d) => router.push(`/vendas/${d.id}/editar`) }),
    cancel: (reason: string) =>
      run(() => cancelSaleAction(id, reason), {
        onSuccess: (d) => {
          if (d.warnings.length) setTimeout(() => alert(`Venda cancelada. Atenção:\n\n${d.warnings.join("\n")}\n\nRegistre eventuais devoluções no Financeiro.`), 50);
        },
      }),
  };
}

export function CancelSaleDialog({ open, onClose, code, onConfirm }: { open: boolean; onClose: () => void; code: string; onConfirm: (reason: string) => Promise<unknown> }) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title={`Cancelar venda ${code}?`}
      confirmLabel="Cancelar venda"
      reason={{ label: "Motivo do cancelamento", required: true }}
      description={
        <ul className="list-disc space-y-1 pl-5">
          <li>Parcelas e contas sem baixa serão canceladas.</li>
          <li>Valores já recebidos ou pagos são mantidos — nada é apagado.</li>
          <li>Reservas e contrato serão marcados como cancelados.</li>
        </ul>
      }
      onConfirm={async (reason) => {
        await onConfirm(reason);
        onClose();
      }}
    />
  );
}

export function SaleRowActions({ id, code, status, canCancel, canCreate }: { id: string; code: string; status: string; canCancel: boolean; canCreate: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const ops = useSaleOps(id);
  return (
    <div className="relative inline-block text-left">
      <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)} aria-label={`Ações da venda ${code}`}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-line bg-white py-1 text-sm shadow-lg" onMouseLeave={() => setOpen(false)}>
          <Link href={`/vendas/${id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
            <Eye className="h-4 w-4" /> Visualizar
          </Link>
          {status !== "CANCELADA" && (
            <Link href={`/vendas/${id}/editar`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50">
              <Pencil className="h-4 w-4" /> Editar
            </Link>
          )}
          {canCreate && (
            <button className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50" onClick={() => ops.duplicate()}>
              <Copy className="h-4 w-4" /> Duplicar
            </button>
          )}
          {canCancel && status !== "CANCELADA" && (
            <button className="flex w-full items-center gap-2 px-3 py-2 text-danger hover:bg-red-50" onClick={() => (setOpen(false), setConfirm(true))}>
              <Ban className="h-4 w-4" /> Cancelar
            </button>
          )}
        </div>
      )}
      <CancelSaleDialog open={confirm} onClose={() => setConfirm(false)} code={code} onConfirm={ops.cancel} />
    </div>
  );
}

export function SaleHeaderActions({ id, code, status, canEdit, canCancel, canCreate }: { id: string; code: string; status: string; canEdit: boolean; canCancel: boolean; canCreate: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const ops = useSaleOps(id);
  return (
    <>
      {canCreate && (
        <Button variant="outline" onClick={() => ops.duplicate()} loading={ops.busy}>
          <Copy className="h-4 w-4" /> Duplicar
        </Button>
      )}
      {canCancel && status !== "CANCELADA" && (
        <Button variant="outline" className="text-danger" onClick={() => setConfirm(true)}>
          <Ban className="h-4 w-4" /> Cancelar
        </Button>
      )}
      {canEdit && status !== "CANCELADA" && (
        <Link href={`/vendas/${id}/editar`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
          <Pencil className="h-4 w-4" /> {status === "ORCAMENTO" ? "Continuar e confirmar" : "Editar"}
        </Link>
      )}
      <CancelSaleDialog open={confirm} onClose={() => setConfirm(false)} code={code} onConfirm={ops.cancel} />
    </>
  );
}
