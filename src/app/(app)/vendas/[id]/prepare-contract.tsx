"use client";
import { FileSignature } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { prepareContractAction } from "@/app/actions";

export function PrepareContractButton({ saleId }: { saleId: string }) {
  const { run, busy } = useAction();
  return (
    <Button variant="secondary" className="w-full" loading={busy} onClick={() => run(() => prepareContractAction(saleId))}>
      <FileSignature className="h-4 w-4" /> Preparar contrato
    </Button>
  );
}
