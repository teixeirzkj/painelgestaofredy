"use client";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { setSaleReviewedAction } from "@/app/actions";

export function ReviewButton({ saleId, reviewed }: { saleId: string; reviewed: boolean }) {
  const { run, busy } = useAction();
  return reviewed ? (
    <Button variant="ghost" size="sm" loading={busy} onClick={() => run(() => setSaleReviewedAction(saleId, false))} title="Desfazer conferência">
      <span className="inline-flex items-center gap-1 text-success">
        <Check className="h-4 w-4" /> Conferida
      </span>
      <Undo2 className="h-3.5 w-3.5 text-subtle" />
    </Button>
  ) : (
    <Button variant="secondary" size="sm" loading={busy} onClick={() => run(() => setSaleReviewedAction(saleId, true))}>
      <Check className="h-4 w-4" /> Conferir
    </Button>
  );
}
