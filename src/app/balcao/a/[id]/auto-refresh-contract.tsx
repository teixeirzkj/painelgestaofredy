"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { refreshContractAction } from "@/app/actions";

/** Volta da correção (cliente ou venda): atualiza a prévia do contrato uma vez e limpa o endereço. */
export function AutoRefreshContract({ id, next }: { id: string; next: string }) {
  const router = useRouter();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    refreshContractAction(id).then((r) => {
      if (r.ok) toast.success("Contrato atualizado com os dados corrigidos.");
      else toast.error(r.error);
      router.replace(next);
      router.refresh();
    });
  }, [id, next, router]);
  return (
    <p className="no-print flex items-center gap-2 border-b border-line bg-brand-25 px-5 py-2 text-sm text-brand-700">
      <RefreshCw className="h-4 w-4 animate-spin" /> Atualizando a prévia do contrato com o que você corrigiu…
    </p>
  );
}
