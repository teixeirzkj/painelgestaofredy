import Link from "next/link";
import { FileStack } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { listInvoices } from "@/server/services/invoices";
import { financeOptions } from "@/server/services/finance";
import { Card, EmptyState, Stat, Table, Td, Th, Badge } from "@/components/ui";
import { FilterForm, FilterSearch, FilterSelect } from "@/components/filter-form";
import { InvoiceStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { INVOICE_STATUS } from "@/lib/constants";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { NewInvoiceButton } from "./invoice-client";

export const metadata = { title: "Faturas de fornecedores" };

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const [{ items, summary }, options] = await Promise.all([listInvoices(ctx, { q: str(sp, "q"), status: str(sp, "status"), supplierId: str(sp, "fornecedor") }), financeOptions(ctx)]);
  return (
    <>
      <Card className="mb-4 grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="Faturas em aberto" value={String(summary.openCount)} />
        <Stat label="Valor em aberto" value={formatBRL(summary.openCents)} />
        <Stat label="Com divergência" value={String(summary.divergentCount)} tone={summary.divergentCount ? "danger" : undefined} />
        <div className="flex items-center justify-end">{can(ctx, "finance.manage") && <NewInvoiceButton suppliers={options.suppliers} today={today(ctx)} />}</div>
      </Card>
      <Card>
        <div className="border-b border-line px-4 py-3">
          <FilterForm>
            <FilterSearch value={str(sp, "q")} placeholder="Número da fatura ou fornecedor" />
            <FilterSelect name="status" label="Situação" value={str(sp, "status")} options={INVOICE_STATUS.values.map((v) => ({ value: v, label: INVOICE_STATUS.label(v) }))} all="Todas" />
            <FilterSelect name="fornecedor" label="Fornecedor" value={str(sp, "fornecedor")} options={options.suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          </FilterForm>
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="Nenhuma fatura registrada"
            description="Registre as faturas de operadoras e consolidadoras para conferir valores e pagar vários lançamentos de uma vez, sem duplicidade."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fatura</Th>
                <Th>Fornecedor</Th>
                <Th>Vencimento</Th>
                <Th align="center">Itens</Th>
                <Th align="right">Valor da fatura</Th>
                <Th align="right">No sistema</Th>
                <Th align="right">Divergência</Th>
                <Th>Situação</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Link href={`/financeiro/faturas/${i.id}`} className="font-semibold text-ink hover:text-brand-700">
                      {i.number}
                    </Link>
                    <p className="text-xs text-muted">emitida {formatDate(i.issueDate)}</p>
                  </Td>
                  <Td>{i.supplier.name}</Td>
                  <Td className={cn("whitespace-nowrap", i.overdue && "font-medium text-danger")}>{formatDate(i.dueDate)}</Td>
                  <Td align="center">{i.count}</Td>
                  <Td align="right" className="font-medium">
                    {formatBRL(i.declaredCents)}
                  </Td>
                  <Td align="right">{formatBRL(i.systemCents)}</Td>
                  <Td align="right">{i.divergenceCents === 0 ? <span className="text-success">—</span> : <Badge tone="red">{formatBRL(i.divergenceCents)}</Badge>}</Td>
                  <Td>
                    <InvoiceStatusBadge s={i.status} />
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
