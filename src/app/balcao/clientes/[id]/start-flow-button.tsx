"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { startBalcaoFlowAction } from "@/app/actions";

/** Abre (ou retoma) o atendimento de 7 etapas com este cliente. */
export function StartFlowButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await startBalcaoFlowAction(clientId, null);
        if (!r.ok) {
          setBusy(false);
          return toast.error(r.error);
        }
        router.push(`/balcao/a/${r.data.id}`);
      }}
      className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
    >
      Iniciar atendimento com este cliente <ArrowRight className="h-4 w-4" />
    </button>
  );
}
