import Link from "next/link";
import { Wallet, CircleCheck, CircleX, CalendarClock, Ticket } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listCredits } from "@/server/services/ops";
import { Badge, Card, EmptyState, KpiCard, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { str, withParams, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { CreditRowActions, NewCreditButton } from "./credit-client";

export const metadata = { title: "Créditos de clientes" };

const STATE = { VALIDO: { label: "Válido", tone: "green" }, VENCE_30: { label: "Vence em 30 dias", tone: "amber" }, VENCIDO: { label: "Vencido", tone: "red" } } as const;

export default async function CreditsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const tab = str(sp, "aba") === "consumidos" ? "consumidos" : "abertos";
  const filter = str(sp, "filtro");
  const data = await listCredits(ctx, { tab, filter });
  const st = data.stats;
  const filters = [
    { key: "", label: "Todos" },
    { key: "validos", label: "Válidos" },
    { key: "30dias", label: "Vencem em 30 dias" },
    { key: "vencidos", label: "Vencidos" },
  ];

  return (
    <>
      <PageHeader
        title="Créditos de clientes"
        description="Créditos em aberto para remarcação e os já usados, com a venda que os consumiu."
        actions={can(ctx, "sales.create") && <NewCreditButton />}
      />
      <Tabs
        active={tab}
        items={[
          { key: "abertos", href: "/creditos", label: "Em aberto", count: st.openCount },
          { key: "consumidos", href: "/creditos?aba=consumidos", label: "Consumidos" },
        ]}
      />
      {tab === "abertos" && (
        <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total em créditos" value={formatBRL(st.totalCents)} icon={Wallet} hint={`${st.openCount} crédito(s) em aberto`} />
          <KpiCard label="Créditos válidos" value={formatBRL(st.validCents)} icon={CircleCheck} tone="green" hint={`${st.validCount} dentro da validade`} />
          <KpiCard label="Créditos vencidos" value={formatBRL(st.expiredCents)} icon={CircleX} tone="red" hint={`${st.expiredCount} fora da validade`} />
          <KpiCard label="Vencem em 30 dias" value={String(st.soonCount)} icon={CalendarClock} tone="amber" hint="contate o cliente antes" />
        </section>
      )}
      <Card>
        {tab === "abertos" && (
          <div className="flex flex-wrap gap-1 border-b border-line px-5 py-3">
            {filters.map((f) => (
              <Link
                key={f.key}
                href={withParams("/creditos", sp, { filtro: f.key || undefined })}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", (filter ?? "") === f.key ? "bg-brand-50 text-brand-700" : "text-muted hover:bg-brand-25 hover:text-ink")}
              >
                {f.label}
              </Link>
            ))}
          </div>
        )}
        {data.items.length === 0 ? (
          <EmptyState
            icon={Ticket}
            title={tab === "abertos" ? "Nenhum crédito em aberto" : "Nenhum crédito consumido"}
            description="Créditos aparecem aqui quando uma venda cancelada gera crédito para o cliente ou quando você lança um crédito manual."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th align="right">Valor</Th>
                <Th>Motivo</Th>
                <Th>Onde está</Th>
                <Th>{tab === "abertos" ? "Venda de origem" : "Usado na venda"}</Th>
                <Th>Validade</Th>
                {tab === "abertos" && <Th />}
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => {
                const s = STATE[c.state as keyof typeof STATE];
                return (
                  <tr key={c.id}>
                    <Td className="py-3.5">
                      <Link href={`/clientes/${c.client.id}`} className="font-medium text-brand-700 hover:underline">
                        {c.client.name}
                      </Link>
                      {c.client.whatsapp && <p className="text-xs text-muted">{c.client.whatsapp}</p>}
                    </Td>
                    <Td align="right" className="font-semibold">
                      {formatBRL(c.amountCents)}
                    </Td>
                    <Td className="max-w-64 text-slate-600">{c.reason}</Td>
                    <Td className="text-slate-600">{c.supplierName ?? "—"}</Td>
                    <Td>
                      {tab === "abertos" ? (
                        c.originSaleId ? (
                          <Link href={`/vendas/${c.originSaleId}`} className="text-brand-700 hover:underline">
                            {c.originCode}
                          </Link>
                        ) : (
                          <span className="text-muted">manual</span>
                        )
                      ) : c.usedSaleId ? (
                        <Link href={`/vendas/${c.usedSaleId}`} className="text-brand-700 hover:underline">
                          {c.usedCode}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {c.expiresAt ? formatDate(c.expiresAt) : <span className="text-muted">sem validade</span>}
                      {tab === "abertos" && s && (
                        <div className="mt-1">
                          <Badge tone={s.tone} dot>
                            {s.label}
                          </Badge>
                        </div>
                      )}
                    </Td>
                    {tab === "abertos" && (
                      <Td align="right">
                        <CreditRowActions id={c.id} clientId={c.client.id} canCancel={can(ctx, "finance.manage")} />
                      </Td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
