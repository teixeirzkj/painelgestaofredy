import Link from "next/link";
import { CalendarDays, BarChart3, Download, TrendingUp, Percent, Landmark, Receipt, CirclePlus, CircleMinus, CircleEqual } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { assertCan } from "@/server/context";
import { workMonth } from "@/server/month";
import { computeDre } from "@/server/services/dre";
import { Card, CardHeader, KpiCard, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatBRL, formatPercentBps, ratioBps } from "@/lib/money";
import { addMonths, endOfMonth } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { PrintButton } from "./print-button";

export const metadata = { title: "DRE" };

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const short = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

export default async function DrePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("reports.financial");
  assertCan(ctx, "sales.view_margin");
  const sp = await searchParams;
  const wm = await workMonth(ctx.timezone);
  const comparative = str(sp, "visao") === "comparativo";
  const months = comparative ? Array.from({ length: 6 }, (_, i) => addMonths(wm.from, i - 5).slice(0, 7)) : [wm.month];
  const dres = await Promise.all(months.map((m) => computeDre(ctx.companyId, { from: `${m}-01`, to: endOfMonth(`${m}-01`) })));
  const cur = dres[dres.length - 1];
  const keys = cur.lines.map((l) => l.key);
  // no comparativo, mostra todas as linhas que aparecem em qualquer mês
  const allKeys = [...new Set(dres.flatMap((d) => d.lines.map((l) => l.key)))];
  const lineOf = (key: string) => dres.map((d) => d.lines.find((l) => l.key === key)).find(Boolean)!;
  const rowKeys = comparative ? allKeys : keys;
  const expenses = cur.netRevenue - cur.result;
  const csv = `/api/relatorios/dre?periodo=personalizado&de=${months[0]}-01&ate=${endOfMonth(`${months[months.length - 1]}-01`)}`;

  return (
    <>
      <PageHeader
        title="DRE — Demonstrativo de resultado"
        description="Receita da agência, deduções, custos e resultado por competência. Vendas pela data da venda; despesas pelo vencimento. Reembolsos e repasses ficam fora do resultado; categorias marcadas como fora do DRE também."
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href="/financeiro/dre" className={cn("inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-medium", !comparative ? "bg-brand-600 text-white shadow-sm" : "border border-line bg-white text-slate-700 hover:bg-brand-25")}>
          <CalendarDays className="h-4 w-4" /> Mensal
        </Link>
        <Link href="/financeiro/dre?visao=comparativo" className={cn("inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-medium", comparative ? "bg-brand-600 text-white shadow-sm" : "border border-line bg-white text-slate-700 hover:bg-brand-25")}>
          <BarChart3 className="h-4 w-4" /> Comparativo 6 meses
        </Link>
        <div className="ml-auto flex gap-2">
          <PrintButton />
          <a href={csv} className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-sm font-medium shadow-sm hover:bg-slate-50">
            <Download className="h-4 w-4" /> CSV
          </a>
        </div>
      </div>

      <Card className="print-area mb-6">
        <CardHeader title={comparative ? `DRE — ${short(months[0])} a ${short(months[5])}` : `DRE — ${wm.label}`} description="% sobre a receita líquida da agência" />
        <Table>
          <thead>
            <tr>
              <Th>Descrição</Th>
              {months.map((m) => (
                <Th key={m} align="right">
                  {comparative ? short(m) : "Valor"}
                </Th>
              ))}
              {!comparative && <Th align="right">% receita</Th>}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map((k) => {
              const l = lineOf(k);
              const isResult = k === "resultado";
              const isTotal = l.kind === "total";
              const Icon = l.kind === "plus" ? CirclePlus : l.kind === "minus" ? CircleMinus : isTotal ? CircleEqual : null;
              const valueOf = (i: number) => {
                const x = dres[i].lines.find((y) => y.key === k);
                return x ? (x.kind === "minus" ? -x.amountCents : x.amountCents) : 0;
              };
              return (
                <tr key={k} className={cn(isResult && "bg-emerald-50/70", isTotal && !isResult && "bg-brand-25", l.kind === "info" && "text-muted")}>
                  <Td className={cn(isTotal && "font-semibold", isResult && "border-t-2 border-emerald-500/60")}>
                    <span className="flex items-center gap-2" style={{ paddingLeft: `${l.level * 16}px` }}>
                      {Icon && <Icon className={cn("h-4 w-4 shrink-0", l.kind === "plus" ? "text-success" : l.kind === "minus" ? "text-danger" : "text-brand-600")} />}
                      {l.label}
                    </span>
                  </Td>
                  {months.map((m, i) => {
                    const v = valueOf(i);
                    return (
                      <Td key={m} align="right" className={cn(isTotal && "font-semibold", isResult && (v < 0 ? "text-danger" : "text-success"), !isTotal && v < 0 && "text-slate-600", isResult && "border-t-2 border-emerald-500/60")}>
                        {formatBRL(v)}
                      </Td>
                    );
                  })}
                  {!comparative && (
                    <Td align="right" className={cn("text-xs text-muted", isResult && "border-t-2 border-emerald-500/60")}>
                      {cur.netRevenue ? formatPercentBps(ratioBps(valueOf(0), cur.netRevenue)) : "—"}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Resultado do período" value={formatBRL(cur.result)} icon={TrendingUp} tone={cur.result < 0 ? "red" : "green"} hint={comparative ? wm.label : undefined} />
        <KpiCard label="Margem líquida (sobre a receita)" value={formatPercentBps(cur.marginBps)} icon={Percent} tone="violet" />
        <KpiCard label="Receita líquida da agência" value={formatBRL(cur.netRevenue)} icon={Landmark} />
        <KpiCard label="Custos, comissões e despesas" value={formatBRL(expenses)} icon={Receipt} tone="amber" />
      </section>
    </>
  );
}
