import Link from "next/link";
import { orNotFound } from "@/server/page-helpers";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { getSupplier } from "@/server/services/registry";
import { Card, CardHeader, PageHeader, Stat, Table, Td, Th, Badge } from "@/components/ui";
import { EntryStatusBadge, ReservationStatusBadge, SaleStatusBadge } from "@/components/status";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PRODUCT_TYPES, SUPPLIER_CATEGORIES } from "@/lib/constants";
import { formatDocument } from "@/lib/utils";
import type { Params } from "@/lib/params";
import { ArchiveSupplierButton, SupplierButton } from "../supplier-form";

export const metadata = { title: "Fornecedor" };

export default async function SupplierPage({ params }: { params: Params }) {
  const ctx = await requirePageContext("suppliers.view");
  const { id } = await params;
  const d = await orNotFound(getSupplier(ctx, id));
  const s = d.supplier;
  const canManage = can(ctx, "suppliers.manage");
  return (
    <>
      <PageHeader
        back={{ href: "/fornecedores", label: "Fornecedores" }}
        title={
          <span className="flex items-center gap-2">
            {s.name} <Badge>{SUPPLIER_CATEGORIES.label(s.category)}</Badge>
          </span>
        }
        description={[s.document && formatDocument(s.document), s.contactName, s.phone, s.email].filter(Boolean).join(" · ")}
        actions={
          canManage && (
            <>
              {!s.archivedAt && <ArchiveSupplierButton id={s.id} />}
              <SupplierButton id={s.id} initial={{ name: s.name, document: s.document, contactName: s.contactName, email: s.email, phone: s.phone, category: s.category, bankInfo: s.bankInfo, pixKey: s.pixKey, notes: s.notes }} />
            </>
          )
        }
      />
      <Card className="mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-5">
        <Stat label="Vendas" value={String(d.stats.salesCount)} />
        <Stat label="Valor negociado" value={formatBRL(d.stats.negotiatedCents)} />
        {d.showFinance && (
          <>
            <Stat label="Pago" value={formatBRL(d.stats.paidCents)} tone="success" />
            <Stat label="A pagar" value={formatBRL(d.stats.openCents)} />
            <Stat label="Vencido" value={formatBRL(d.stats.overdueCents)} tone={(d.stats.overdueCents ?? 0) > 0 ? "danger" : undefined} />
          </>
        )}
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        {d.showFinance && (
          <Card>
            <CardHeader title="Contas a pagar" />
            {d.payables.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Nenhum lançamento.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Vencimento</Th>
                    <Th>Venda</Th>
                    <Th align="right">Saldo</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.payables.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        <Link href={`/financeiro/pagar?abrir=${p.id}`} className="hover:text-brand-700">
                          {formatDate(p.dueDate)}
                        </Link>
                      </Td>
                      <Td>{p.sale ? <Link className="text-brand-700 hover:underline" href={`/vendas/${p.sale.id}`}>{p.sale.code}</Link> : p.description}</Td>
                      <Td align="right">{formatBRL(p.balanceCents)}</Td>
                      <Td>
                        <EntryStatusBadge kind="payable" s={p.displayStatus} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {d.receivables.length > 0 && (
              <div className="border-t border-line px-5 py-3 text-sm">
                Comissões a receber deste fornecedor:{" "}
                <strong>{formatBRL(d.receivables.filter((r) => r.status !== "PAGO").reduce((a, r) => a + r.balanceCents, 0))}</strong>
              </div>
            )}
          </Card>
        )}
        <Card>
          <CardHeader title="Reservas vinculadas" />
          {d.reservations.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma reserva.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Venda</Th>
                  <Th>Cliente</Th>
                  <Th>Produto</Th>
                  <Th>Início</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {d.reservations.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link className="text-brand-700 hover:underline" href={`/vendas/${r.sale.id}`}>
                        {r.sale.code}
                      </Link>
                      {r.locator && <p className="text-xs text-muted">{r.locator}</p>}
                    </Td>
                    <Td className="max-w-40 truncate">{r.sale.client.name}</Td>
                    <Td className="text-slate-600">{PRODUCT_TYPES.label(r.productType)}</Td>
                    <Td>{formatDate(r.startDate)}</Td>
                    <Td>
                      <ReservationStatusBadge s={r.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Produtos vendidos" />
          <Table>
            <thead>
              <tr>
                <Th>Venda</Th>
                <Th>Data</Th>
                <Th>Cliente</Th>
                <Th>Produto</Th>
                <Th align="right">Valor</Th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Link className="text-brand-700 hover:underline" href={`/vendas/${i.sale.id}`}>
                      {i.sale.code}
                    </Link>{" "}
                    <SaleStatusBadge s={i.sale.status} />
                  </Td>
                  <Td>{formatDate(i.sale.saleDate)}</Td>
                  <Td className="max-w-48 truncate">{i.sale.client.name}</Td>
                  <Td className="text-slate-600">{i.description ?? PRODUCT_TYPES.label(i.productType)}</Td>
                  <Td align="right">{formatBRL(i.priceCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {(s.notes || (d.showFinance && (s.bankInfo || s.pixKey))) && (
          <Card className="xl:col-span-2">
            <CardHeader title="Informações adicionais" />
            <div className="grid gap-4 p-5 text-sm sm:grid-cols-2">
              {d.showFinance && (s.bankInfo || s.pixKey) && (
                <div>
                  <p className="text-xs text-muted">Dados bancários</p>
                  <p className="whitespace-pre-wrap">{s.bankInfo}</p>
                  {s.pixKey && <p>PIX: {s.pixKey}</p>}
                </div>
              )}
              {s.notes && (
                <div>
                  <p className="text-xs text-muted">Observações</p>
                  <p className="whitespace-pre-wrap">{s.notes}</p>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
