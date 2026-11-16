import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { passengerSheet } from "@/server/services/passenger-sheet";
import { formatDate } from "@/lib/dates";
import { str, type Params, type SearchParams } from "@/lib/params";
import { balcaoContext } from "../../shared";
import { BalcaoHeader } from "../../header";
import { PassengerCards } from "./sheet-client";

export const metadata = { title: "Ficha dos passageiros" };

const safeBack = (v?: string | null) => (v && v.startsWith("/balcao") && !v.startsWith("//") ? v : "/balcao/ficha");

export default async function FichaPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const back = safeBack(str(sp, "voltar"));
  const ctx = await balcaoContext(`/balcao/ficha/${id}`);
  const sheet = await passengerSheet(ctx, id).catch(() => null);
  if (!sheet) notFound();
  const { sale } = sheet;
  return (
    <>
      <BalcaoHeader ctx={ctx} view={0} done={[]} sheetHref={`/balcao/ficha?voltar=${encodeURIComponent(back)}`} />
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <section className="rounded-[14px] border border-line bg-white p-5 shadow-[var(--shadow-card)]">
          <p className="text-xs font-medium text-muted">Ficha dos passageiros · {sale.code}</p>
          <h1 className="font-display text-lg font-semibold text-ink">{sale.destination ?? "Viagem"}</h1>
          <p className="text-sm text-slate-600">
            {sale.tripStart ? `${formatDate(sale.tripStart)}${sale.tripEnd ? ` a ${formatDate(sale.tripEnd)}` : ""}` : "Datas não informadas"} · {sale.passengerCount} passageiro(s)
            {sheet.locators.length > 0 && ` · localizador ${sheet.locators.join(", ")}`}
          </p>
          {sheet.flights.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2 text-xs">
              {sheet.flights.map((f, i) => (
                <li key={i} className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
                  {f.airline} {f.flightNumber} · {f.origin} → {f.destination} · {f.departureAt.slice(8, 10)}/{f.departureAt.slice(5, 7)} {f.departureAt.slice(11, 16)}
                </li>
              ))}
            </ul>
          )}
          {sheet.missingPassengers > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              A venda tem {sale.passengerCount} passageiro(s), mas só {sale.passengerCount - sheet.missingPassengers} estão cadastrados. Complete os passageiros na venda.
            </p>
          )}
        </section>
        <PassengerCards people={sheet.people} />
      </main>
    </>
  );
}
