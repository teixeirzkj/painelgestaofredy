import { redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import { fredyCardPrefill } from "@/server/services/fredy";
import { Notice } from "@/components/ui";
import { str, type SearchParams } from "@/lib/params";
import { SaleForm } from "@/app/(app)/vendas/sale-form";
import { newSaleFormData } from "@/app/(app)/vendas/sale-form-data";
import { prisma } from "@/server/db";
import { balcaoContext, carry, clientGuideFacts, flowKeyFor } from "../shared";
import { BalcaoGuide } from "../guide";
import { can } from "@/server/context";

/** Etapa 2 da venda rápida: lançar a venda (já com o cliente e, se veio do Frédy, os dados do card). */
export default async function BalcaoVendaPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const card = str(sp, "card") ?? null;
  const clientId = str(sp, "cliente");
  const ctx = await balcaoContext(`/balcao/venda${carry(card, { cliente: clientId })}`);
  if (!clientId) redirect(`/balcao${carry(card)}`);

  let prefill: Awaited<ReturnType<typeof fredyCardPrefill>> | null = null;
  if (card) prefill = await fredyCardPrefill(ctx, card).catch((e) => (e instanceof AppError ? null : null));
  if (prefill?.existingSale) redirect(`/balcao/${prefill.existingSale.id}`);
  const integ = card ? await prisma.fredyIntegration.findUnique({ where: { companyId: ctx.companyId }, select: { defaultProductType: true } }) : null;

  const form = await newSaleFormData(ctx, {
    clientId,
    destination: prefill?.destination,
    tripStart: prefill?.tripStart,
    tripEnd: prefill?.tripEnd && prefill.tripStart && prefill.tripEnd < prefill.tripStart ? null : prefill?.tripEnd,
    passengerCount: prefill?.passengerCount,
    priceCents: prefill?.priceCents,
    description: prefill?.title,
    productType: integ?.defaultProductType,
  });
  if (!form.initial.client) redirect(`/balcao${carry(card)}`);
  const guide = {
    page: "venda" as const,
    flowKey: flowKeyFor(prefill ? card : null),
    cardTitle: prefill?.title ?? null,
    ...(await clientGuideFacts(ctx, clientId)),
    saleExists: false,
    saleConfirmed: false,
    contractStatus: null,
    canContract: can(ctx, "contracts.manage"),
    attachments: 0,
  };
  return (
    <div className="space-y-4">
      <BalcaoGuide facts={guide} />
      {prefill && <Notice title={`Venda do card: ${prefill.title}`}>Ao confirmar, o card é marcado como ganho no Frédy, com o valor final e uma nota com o código da venda.</Notice>}
      <SaleForm {...form} fredyCardId={prefill ? card : null} afterSaveHref="/balcao/:id" />
    </div>
  );
}
