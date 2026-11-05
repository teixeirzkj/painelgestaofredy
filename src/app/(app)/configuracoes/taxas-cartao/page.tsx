import { CreditCard } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { listCardFees } from "@/server/services/admin";
import { Badge, Card, EmptyState, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatPercentBps } from "@/lib/money";
import { CARD_MODALITIES } from "@/lib/constants";
import { CardFeeEditor } from "./fees-client";

export const metadata = { title: "Taxas de cartão" };

export default async function CardFeesPage() {
  const ctx = await requirePageContext("settings.manage");
  const fees = await listCardFees(ctx);
  return (
    <>
      <PageHeader back={{ href: "/configuracoes", label: "Configurações" }} title="Taxas de cartão" description="Taxa da maquininha da agência, por modalidade e faixa de parcelas." actions={<CardFeeEditor />} />
      <Notice className="mb-5">
        Vale só para cartão que entra no caixa da agência. A parcela do cliente passa a vencer na data de liquidação da adquirente e a taxa vira uma conta a pagar no grupo Deduções, com o mesmo vencimento. Cartão passado direto na operadora não é afetado.
      </Notice>
      <Card>
        {fees.length === 0 ? (
          <EmptyState icon={CreditCard} title="Nenhuma taxa cadastrada" description="Sem taxa, o cartão na maquininha entra pelo valor bruto e sem custo." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Modalidade</Th>
                <Th>Parcelas</Th>
                <Th align="right">Taxa</Th>
                <Th align="right">Liquidação</Th>
                <Th>Bandeira</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {fees.map((f) => (
                <tr key={f.id}>
                  <Td className="font-medium">{CARD_MODALITIES.label(f.modality)}</Td>
                  <Td>{f.modality === "DEBITO" ? "à vista" : f.installmentsFrom === f.installmentsTo ? `${f.installmentsFrom}x` : `${f.installmentsFrom}x a ${f.installmentsTo}x`}</Td>
                  <Td align="right">{formatPercentBps(f.rateBps)}</Td>
                  <Td align="right">{f.settlementDays === 0 ? "no mesmo dia" : `${f.settlementDays} dias`}</Td>
                  <Td className="text-slate-600">{f.brand ?? "Todas"}</Td>
                  <Td>{f.active ? <Badge tone="green" dot>Ativa</Badge> : <Badge>Inativa</Badge>}</Td>
                  <Td align="right">
                    <CardFeeEditor fee={f} />
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
