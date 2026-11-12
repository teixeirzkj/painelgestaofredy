"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { checkFlightsNowAction, resolveFlightAlertAction } from "@/app/actions";
import { ALERT_LABEL, clientMessage } from "@/lib/flight-alerts";
import { cn } from "@/lib/utils";

export type FlightAlert = {
  id: string;
  kind: string;
  flight: string;
  departureAt: string;
  newTimeAt: string | null;
  detail: string | null;
  detectedAt: Date | string;
  sale: { id: string; code: string; passengerCount: number; client: { name: string; whatsapp: string | null; phone: string | null } };
};

const hhmm = (v?: string | null) => (v ? v.slice(11, 16) : "");
const ddmm = (v?: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}` : "");
const TONE: Record<string, string> = {
  CANCELADO: "border-red-200 bg-red-50",
  POSSIVEL_CANCELAMENTO: "border-amber-200 bg-amber-50",
  ATRASO: "border-amber-200 bg-amber-50",
  HORARIO: "border-violet-200 bg-violet-50",
  DESVIADO: "border-red-200 bg-red-50",
};

function whatsappLink(phone: string | null, text: string) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits.length <= 11 ? "55" + digits : digits}?text=${encodeURIComponent(text)}`;
}

/** Alertas do monitor de voos, com a mensagem pronta para o cliente. */
export function FlightAlerts({ alerts, agency }: { alerts: FlightAlert[]; agency: string }) {
  const router = useRouter();
  const { run } = useAction();
  return (
    <ul className="space-y-3 p-5">
      {alerts.map((a) => {
        const msg = clientMessage(a, a.sale.client.name, agency);
        const wa = whatsappLink(a.sale.client.whatsapp ?? a.sale.client.phone, msg);
        return (
          <li key={a.id} className={cn("rounded-lg border p-3 text-sm", TONE[a.kind] ?? "border-line")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">
                  {ALERT_LABEL[a.kind] ?? a.kind} · {a.flight}
                </p>
                <p className="text-xs text-slate-700">
                  Partida na venda: {ddmm(a.departureAt)} {hhmm(a.departureAt)}
                  {a.newTimeAt && <> · {a.kind === "ATRASO" ? "nova previsão" : "novo horário"}: {ddmm(a.newTimeAt) !== ddmm(a.departureAt) ? `${ddmm(a.newTimeAt)} ` : ""}{hhmm(a.newTimeAt)}</>}
                  {a.detail && <> · {a.detail}</>}
                </p>
                <p className="mt-1 text-xs">
                  <Link href={`/vendas/${a.sale.id}`} className="font-medium text-brand-700 hover:underline">
                    {a.sale.client.name}
                  </Link>{" "}
                  · {a.sale.code}
                  {a.sale.passengerCount > 1 ? ` · ${a.sale.passengerCount} passageiros` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {wa && (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-xs font-medium text-white hover:bg-emerald-700">
                    <MessageCircle className="h-3.5 w-3.5" /> Avisar no WhatsApp
                  </a>
                )}
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-xs font-medium hover:bg-slate-50"
                  onClick={() => navigator.clipboard.writeText(msg).then(() => toast.success("Mensagem copiada."))}
                >
                  <Copy className="h-3.5 w-3.5" /> Copiar mensagem
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 text-xs font-medium hover:bg-slate-50"
                  onClick={() => run(() => resolveFlightAlertAction(a.id), { onSuccess: () => router.refresh() })}
                >
                  <Check className="h-3.5 w-3.5" /> Resolvido
                </button>
              </div>
            </div>
            <p className="mt-2 rounded-md bg-white/70 p-2 text-xs text-slate-600">{msg}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** Confere os voos de hoje e amanhã agora (cada voo no máximo 1 vez por dia). */
export function CheckFlightsNow() {
  const router = useRouter();
  const { run, busy } = useAction();
  return (
    <Button
      variant="outline"
      size="sm"
      loading={busy}
      onClick={() =>
        run(() => checkFlightsNowAction(), {
          success: false,
          onSuccess: (r) => {
            const d = r as { skipped?: string; checked?: number; alerts?: number; notFound?: number; error?: string | null };
            if (d.skipped) toast.info(`Não conferiu: ${d.skipped}.`);
            else if (d.error) toast.error(`${d.checked ?? 0} voo(s) conferido(s). ${d.error}`);
            else if (!d.checked) toast.info("Os voos de hoje e amanhã já foram conferidos hoje.");
            else toast.success(`${d.checked} voo(s) conferido(s), ${d.alerts} alerta(s) novo(s)${d.notFound ? `, ${d.notFound} sem informação` : ""}.`);
            router.refresh();
          },
        })
      }
    >
      {!busy && <RefreshCw className="h-4 w-4" />} Conferir agora
    </Button>
  );
}
