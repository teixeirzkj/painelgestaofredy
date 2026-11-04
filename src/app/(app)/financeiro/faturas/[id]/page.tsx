import Link from "next/link";
import { ChevronLeft, ListChecks, ListPlus, Paperclip, Scale } from "lucide-react";
import { orNotFound } from "@/server/page-helpers";
import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { getInvoice } from "@/server/services/invoices";
import { financeOptions } from "@/server/services/finance";
import { Card, CardHeader, Notice, Table, Td, Th, Badge, DataList } from "@/components/ui";
import { EntryStatusBadge, InvoiceStatusBadge } from "@/components/status";
import { AttachmentsPanel } from "@/components/attachments";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import type { Params } from "@/lib/params";
import { cn } from "@/lib/utils";
import { AddItems, InvoiceActions, RemoveItemButton } from "../invoice-client";

export const metadata = { title: "Fatura de fornecedor" };

export default async function InvoicePage({ params }: { params: Params }) {
  const ctx = await requirePageContext("finance.view");
  const { id } = await params;
  const [inv, options] = await orNotFound(Promise.all([getInvoice(ctx, id), financeOptions(ctx)]));
  const canManage = can(ctx, "finance.manage");
  const hasPayments = inv.paidCents > 0;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/financeiro/faturas" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-brand-600">
            <ChevronLeft className="h-3.5 w-3.5" /> Faturas
          </Link>
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold">
            Fatura {inv.number} <InvoiceStatusBadge s={inv.status} />
          </h2>
          <p className="text-sm text-muted">
            <Link href={`/fornecedores/${inv.supplier.id}`} className="hover:text-brand-700">
              {inv.supplier.name}
            </Link>{" "}
            · emitida {formatDate(inv.issueDate)} · vence {formatDate(inv.dueDate)}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <InvoiceActions id={inv.id} status={inv.status} divergenceCents={inv.divergenceCents} openCents={inv.openCents} accounts={options.accounts} today={today(ctx)} hasPayments={hasPayments} />
          </div>
        )}
      </div>

      <Card className="mb-6 p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <Scale className="h-4 w-4 text-brand-600" /> Conferência
        </h3>
        <DataList
          columns={3}
          items={[
            { label: "Valor cobrado pelo fornecedor", value: <span className="font-display text-lg font-semibold">{formatBRL(inv.declaredCents)}</span> },
            { label: `Soma dos ${inv.count} lançamento(s) no sistema`, value: <span className="font-display text-lg font-semibold">{formatBRL(inv.systemCents)}</span> },
            {
              label: "Divergência",
              value: <span className={cn("font-display text-lg font-semibold", inv.divergenceCents === 0 ? "text-success" : "text-danger")}>{inv.divergenceCents === 0 ? "Sem divergência" : formatBRL(inv.divergenceCents)}</span>,
            },
            { label: "Pago", value: formatBRL(inv.paidCents) },
            { label: "Saldo a pagar", value: formatBRL(inv.openCents) },
            { label: "Conferida em", value: inv.checkedAt ? new Date(inv.checkedAt).toLocaleDateString("pt-BR") : "—" },
          ]}
        />
      </Card>

      {inv.status === "ABERTA" && inv.divergenceCents !== 0 && (
        <Notice tone="amber" title="Fatura com divergência" className="mb-6">
          {inv.divergenceCents > 0
            ? "O fornecedor cobrou mais do que o sistema prevê. Vincule os lançamentos que faltam ou registre a diferença (ex.: taxa administrativa)."
            : "O fornecedor cobrou menos do que o sistema prevê. Remova itens que não foram faturados ou revise o custo das vendas vinculadas."}
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <Card>
            <CardHeader title="Lançamentos da fatura" icon={ListChecks} description="Contas a pagar consolidadas — o vencimento passa a ser o da fatura." />
            {inv.payables.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">Nenhum lançamento vinculado ainda.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Lançamento</Th>
                    <Th>Venda</Th>
                    <Th align="right">Valor</Th>
                    <Th align="right">Pago</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {inv.payables.map((p) => (
                    <tr key={p.id} className={p.status === "CANCELADO" ? "opacity-50" : ""}>
                      <Td className="max-w-72">
                        <Link href={`/financeiro/pagar?abrir=${p.id}`} className="block truncate font-medium text-ink hover:text-brand-700">
                          {p.description}
                        </Link>
                        {p.origin === "AJUSTE_FATURA" && <Badge tone="amber">ajuste</Badge>}
                      </Td>
                      <Td className="max-w-44 whitespace-nowrap">
                        {p.sale ? (
                          <Link href={`/vendas/${p.sale.id}`} className="text-brand-700 hover:underline">
                            {p.sale.code}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {p.sale && <p className="truncate text-xs text-muted">{p.sale.client.name}</p>}
                      </Td>
                      <Td align="right">{formatBRL(p.amountCents)}</Td>
                      <Td align="right">{formatBRL(p.paidCents)}</Td>
                      <Td>
                        <EntryStatusBadge kind="payable" s={p.displayStatus} />
                      </Td>
                      <Td align="right">{canManage && inv.status === "ABERTA" && p.settledCents === 0 && <RemoveItemButton invoiceId={inv.id} payableId={p.id} />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          {canManage && inv.status === "ABERTA" && (
            <Card>
              <CardHeader title="Adicionar lançamentos em aberto deste fornecedor" icon={ListPlus} description="Custos das vendas e despesas manuais ainda fora de faturas" />
              <AddItems invoiceId={inv.id} candidates={inv.candidates} />
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Documentos da fatura" icon={Paperclip} />
            <AttachmentsPanel target={{ kind: "invoice", id: inv.id }} items={inv.attachments} canUpload={canManage} kinds={["FATURA", "COMPROVANTE", "OUTRO"]} timezone={ctx.timezone} emptyText="Anexe o PDF da fatura e o comprovante de pagamento." />
          </Card>
          {inv.notes && (
            <Card>
              <CardHeader title="Observações" />
              <p className="whitespace-pre-wrap p-5 text-sm text-slate-700">{inv.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
