"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileStack } from "lucide-react";
import { Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ui/client";
import { useAction } from "@/components/use-action";
import { generateTripContractAction } from "@/app/actions";

/** Junta as vendas confirmadas da viagem em um contrato só (com confirmação) e abre o contrato gerado. */
export function GenerateTripContractButton({
  tripId,
  codes,
  label = "Gerar um contrato para a viagem toda",
  openAfter = true,
  className,
}: {
  tripId: string;
  codes: string[];
  label?: string;
  /** abre a página do contrato depois de gerar (na venda rápida a tela só recarrega) */
  openAfter?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { run, busy } = useAction();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" className={className} loading={busy} onClick={() => setOpen(true)}>
        <FileStack className="h-4 w-4" /> {label}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        danger={false}
        title="Um contrato para a viagem toda"
        description={`Vamos juntar as vendas ${codes.join(", ")} em um contrato só. Os contratos separados dessas vendas que ainda não foram enviados ao cliente serão trocados por este. Continuar?`}
        confirmLabel="Juntar em um contrato"
        onConfirm={async () => {
          await run(() => generateTripContractAction(tripId), {
            refresh: !openAfter,
            onSuccess: (d) => {
              setOpen(false);
              if (openAfter) router.push(`/contratos/${d.id}`);
            },
          });
        }}
      />
    </>
  );
}
