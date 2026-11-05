import Link from "next/link";
import { ClipboardCheck, Coins, Sparkles, ArrowDownToLine, Info } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { prisma } from "@/server/db";
import { workMonth } from "@/server/month";
import { listForReview } from "@/server/services/ops";
import { Badge, Card, EmptyState, KpiCard, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSelect } from "@/components/filter-form";
import { SaleStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { ReviewButton } from "./review-button";

export const metadata = { title: "Conferência de vendas" };

export default async function ReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const wm = await workMonth(ctx.timezone);
  const f = { supplierId: str(sp, "fornecedor"), status: str(sp, "status") };
  const [d, suppliers, decendial] = await Promise.all([
    listForReview(ctx, { from: wm.from, to: wm.to, ...f }),
    prisma.supplier.findMany({ where: { companyId: ctx.companyId, archivedAt: null, category: { not: "INTERMEDIARIO" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.count({ where: { companyId: ctx.companyId, billingCycle: "DECENDIAL" } }),
  ]);
  const focus = str(sp, "venda");
  const canManage = can(ctx, "finance.manage");
  return (
    <>
      <PageHeader title="Conferência de vendas" description="O financeiro confere cada venda do mês. Depois de conferida, o vendedor só altera a venda com uma solicitação aprovada." />
      {decendial > 0 && (
        <Notice className="mb-5">
          <span className="inline-flex items-center gap-1">
            <Info className="h-3.5 w-3.5" /> Fornecedores com fatura decendial também têm a conferência pela fatura em{" "}
            <Link href="/financeiro/decendios" className="font-medium underline">
              Conciliação por decêndio
            </Link>
            .
          </span>
        </Notice>
      )}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Vendas no mês" value={String(d.stats.count)} icon={ClipboardCheck} hint={`${d.stats.reviewed} conferidas · ${d.stats.pending} pendentes`} />
        <KpiCard label="Comissões de fornecedores" value={formatBRL(d.stats.commissionCents)} icon={Coins} tone="violet" hint={wm.label} />
        <KpiCard label="Over" value={formatBRL(d.stats.overCents)} icon={Sparkles} tone="amber" />
        <KpiCard label="A receber de fornecedores" value={formatBRL(d.stats.toReceiveCents)} icon={ArrowDownToLine} tone="green" hint="comissão + over + RAV/DU" />
      </section>
      <Card>
        <div className="border-b border-line px-5 py-3">
          <FilterForm>
            <FilterSelect name="fornecedor" label="Operadora / fornecedor" value={f.supplierId} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} all="Todas as operadoras" />
            <FilterSelect
              name="status"
              label="Situação"
              value={f.status}
              options={[
                { value: "pendentes", label: "Pendentes" },
                { value: "conferidas", label: "Conferidas" },
              ]}
              all="Todos os status"
            />
          </FilterForm>
        </div>
        {d.rows.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="Nenhuma venda encontrada" description="Ajuste os filtros ou troque o mês no topo da tela." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Venda</Th>
                <Th>Cliente / vendedor</Th>
                <Th>Operadoras</Th>
                <Th align="right">Total</Th>
                <Th align="right">Comissão</Th>
                <Th align="right">Over</Th>
                <Th align="right">A receber</Th>
                <Th>Conferência</Th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className={cn(focus === r.id && "bg-amber-50/60")}>
                  <Td className="whitespace-nowrap">
                    <Link href={`/vendas/${r.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {r.code}
                    </Link>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                      <SaleStatusBadge s={r.status} /> {formatDate(r.saleDate)}
                    </div>
                  </Td>
                  <Td className="max-w-52">
                    <span className="block truncate">{r.client}</span>
                    <span className="block text-xs text-muted">{r.seller}</span>
                  </Td>
                  <Td className="max-w-52 truncate text-slate-600">{r.suppliers || "—"}</Td>
                  <Td align="right" className="font-medium">
                    {formatBRL(r.grossCents)}
                  </Td>
                  <Td align="right">{formatBRL(r.commissionCents)}</Td>
                  <Td align="right">{formatBRL(r.overCents)}</Td>
                  <Td align="right">{formatBRL(r.toReceiveCents)}</Td>
                  <Td>
                    {canManage ? (
                      <ReviewButton saleId={r.id} reviewed={!!r.reviewedAt} />
                    ) : r.reviewedAt ? (
                      <Badge tone="green" dot>
                        Conferida
                      </Badge>
                    ) : (
                      <Badge tone="amber" dot>
                        Pendente
                      </Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
