import Link from "next/link";
import { ArrowLeftRight, ArrowUpFromLine, ArrowDownToLine, Scale } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { workMonth } from "@/server/month";
import { listAgencyTransfers } from "@/server/services/ops";
import { Badge, Card, CardHeader, EmptyState, KpiCard, PageHeader, Table, Td, Th } from "@/components/ui";
import { EntryStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { NewTransferButton } from "./transfer-client";

export const metadata = { title: "Repasses" };

export default async function TransfersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const wm = await workMonth(ctx.timezone);
  const status = str(sp, "status");
  const d = await listAgencyTransfers(ctx, wm.from, wm.to, status);
  const tab = (key: string | undefined, label: string) => (
    <Link href={key ? `/financeiro/repasses?status=${key}` : "/financeiro/repasses"} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", status === key ? "bg-brand-600 text-white" : "text-muted hover:bg-brand-25 hover:text-ink")}>
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader
        title="Repasses entre agências"
        description="Valores a repassar ou a receber de agências parceiras (ex.: comissão de venda sua que caiu na fatura de outra agência do grupo). Cada repasse vira uma conta a pagar ou a receber."
        actions={can(ctx, "finance.manage") && <NewTransferButton today={wm.isCurrent ? wm.today : wm.from} />}
      />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Total a repassar" value={formatBRL(d.toPay)} icon={ArrowUpFromLine} tone="red" />
        <KpiCard label="Total a receber" value={formatBRL(d.toReceive)} icon={ArrowDownToLine} tone="green" />
        <KpiCard label="Saldo líquido" value={formatBRL(d.net)} icon={Scale} tone={d.net < 0 ? "amber" : "blue"} />
      </section>
      <div className="mb-4 inline-flex gap-1 rounded-xl border border-line bg-white p-1">
        {tab(undefined, "Todos")}
        {tab("pendentes", "Pendentes")}
        {tab("pagos", "Pagos")}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title={`Matriz de repasses — ${wm.label}`} icon={ArrowLeftRight} />
          {d.matrix.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Nenhum repasse neste período.</p>
          ) : (
            <ul className="divide-y divide-line">
              {d.matrix.map((m) => (
                <li key={m.counterparty} className="px-5 py-3 text-sm">
                  <p className="font-medium text-ink">{m.counterparty}</p>
                  <p className="mt-0.5 flex justify-between text-xs text-muted">
                    <span>repassar {formatBRL(m.pay)}</span>
                    <span>receber {formatBRL(m.receive)}</span>
                    <span className={cn("font-semibold", m.receive - m.pay < 0 ? "text-danger" : "text-success")}>{formatBRL(m.receive - m.pay)}</span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Detalhamento" description={`${d.items.length} repasse(s) no período`} />
          {d.items.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title="Nenhum repasse encontrado" description="Altere o filtro ou o mês no topo da tela." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Agência</Th>
                  <Th>Tipo</Th>
                  <Th>Referência</Th>
                  <Th align="right">Valor</Th>
                  <Th>Vencimento</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr key={i.id}>
                    <Td className="font-medium">{i.counterparty}</Td>
                    <Td>{i.direction === "A_REPASSAR" ? <Badge tone="red">A repassar</Badge> : <Badge tone="green">A receber</Badge>}</Td>
                    <Td className="text-slate-600">{i.reference ?? "—"}</Td>
                    <Td align="right" className="font-semibold">
                      {formatBRL(i.amountCents)}
                    </Td>
                    <Td>{formatDate(i.dueDate)}</Td>
                    <Td>
                      {i.entryId ? (
                        <Link href={`/financeiro/${i.entryKind}?abrir=${i.entryId}&periodo=todos`}>
                          <EntryStatusBadge kind={i.direction === "A_REPASSAR" ? "payable" : "receivable"} s={i.entryStatus} />
                        </Link>
                      ) : (
                        <EntryStatusBadge s={i.entryStatus} />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
