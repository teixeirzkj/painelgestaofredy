import Link from "next/link";
import { Coins, Sparkles, Landmark, CheckCheck, Users } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { workMonth } from "@/server/month";
import { commissionsByMonth } from "@/server/services/ops";
import { Card, EmptyState, KpiCard, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "Comissões" };

export default async function CommissionsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const wm = await workMonth(ctx.timezone);
  const onlyReviewed = str(sp, "conferidas") === "1";
  const d = await commissionsByMonth(ctx, wm.from, wm.to, onlyReviewed);
  const t = d.totals;
  return (
    <>
      <PageHeader title="Comissões" description="Comissões e incentivos recebidos dos fornecedores e comissões a pagar aos vendedores, por mês da venda." />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Comissões de fornecedores" value={formatBRL(t.supplierCommission)} icon={Coins} />
        <KpiCard label="Over / incentivos" value={formatBRL(t.over)} icon={Sparkles} tone="violet" />
        <KpiCard label="Receita da agência" value={formatBRL(t.revenue)} icon={Landmark} tone="green" />
        <KpiCard label="Comissões de vendedores" value={formatBRL(t.sellerCommission)} icon={Users} tone="amber" />
        <KpiCard label="Vendas conferidas" value={`${t.reviewed}/${t.count}`} icon={CheckCheck} tone="slate" href="/financeiro/conferencia" />
      </section>
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="mr-auto text-[15px] font-semibold">
            Comissões — <span>{wm.label}</span>
          </h2>
          <Link
            href={onlyReviewed ? "/financeiro/comissoes" : "/financeiro/comissoes?conferidas=1"}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium", onlyReviewed ? "border-brand-200 bg-brand-50 text-brand-700" : "border-line bg-white text-slate-700 hover:bg-brand-25")}
          >
            <CheckCheck className="h-3.5 w-3.5" /> Apenas conferidas
          </Link>
        </div>
        {d.rows.length === 0 ? (
          <EmptyState icon={Coins} title="Nenhuma comissão neste mês" description={onlyReviewed ? "Nenhuma venda conferida neste mês. Desmarque o filtro para ver todas." : "Sem vendas confirmadas no mês selecionado."} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Vendedor</Th>
                <Th align="center">Vendas</Th>
                <Th align="right">Total vendido</Th>
                <Th align="right">Comissão fornecedor</Th>
                <Th align="right">Over</Th>
                <Th align="right">Receita agência</Th>
                <Th align="right">Comissão vendedor</Th>
                <Th align="right">Pago ao vendedor</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.sellerId}>
                  <Td className="font-medium text-ink">{r.seller}</Td>
                  <Td align="center">{r.count}</Td>
                  <Td align="right">{formatBRL(r.gross)}</Td>
                  <Td align="right">{formatBRL(r.supplierCommission)}</Td>
                  <Td align="right">{formatBRL(r.over)}</Td>
                  <Td align="right">{formatBRL(r.revenue)}</Td>
                  <Td align="right" className="font-semibold text-ink">
                    {formatBRL(r.sellerCommission)}
                  </Td>
                  <Td align="right" className={r.paid >= r.sellerCommission ? "text-success" : "text-slate-600"}>
                    {formatBRL(r.paid)}
                  </Td>
                  <Td align="right">
                    {r.payableIds.length > 0 && (
                      <Link href={`/financeiro/pagar?category=COMISSOES&status=ABERTO&q=${encodeURIComponent(r.seller)}&periodo=todos`} className="text-xs font-medium text-brand-600 hover:underline">
                        Pagar
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-brand-25 font-semibold">
                <Td>Total</Td>
                <Td align="center">{t.count}</Td>
                <Td align="right">{formatBRL(d.rows.reduce((a, r) => a + r.gross, 0))}</Td>
                <Td align="right">{formatBRL(t.supplierCommission)}</Td>
                <Td align="right">{formatBRL(t.over)}</Td>
                <Td align="right">{formatBRL(t.revenue)}</Td>
                <Td align="right">{formatBRL(t.sellerCommission)}</Td>
                <Td align="right">{formatBRL(d.rows.reduce((a, r) => a + r.paid, 0))}</Td>
                <Td />
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </>
  );
}
