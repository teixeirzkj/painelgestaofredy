import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { prisma } from "@/server/db";
import { supplierOptions } from "@/server/services/registry";
import { sellerOptions } from "@/server/services/settings";
import { PageHeader } from "@/components/ui";
import { SaleForm } from "../sale-form";
import { str, type SearchParams } from "@/lib/params";
import { clientScope } from "@/server/services/registry";
import { activeRules } from "@/server/services/catalog";
import { excursionOptions } from "@/server/services/excursions";
import { cardOptions } from "@/server/services/cards";

export const metadata = { title: "Nova venda" };

export default async function NewSalePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("sales.create");
  const sp = await searchParams;
  const tripParam = str(sp, "viagem");
  const trip = tripParam ? await prisma.trip.findFirst({ where: { id: tripParam, companyId: ctx.companyId }, select: { id: true, clientId: true, destination: true } }) : null;
  const clientId = trip?.clientId ?? str(sp, "cliente");
  const [suppliers, sellers, me, client, rules, excursions, agencyCards] = await Promise.all([
    supplierOptions(ctx),
    sellerOptions(ctx),
    prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { commissionRateBps: true } }),
    clientId ? prisma.client.findFirst({ where: { AND: [{ id: clientId }, clientScope(ctx)] }, select: { id: true, name: true, document: true, whatsapp: true } }) : null,
    activeRules(ctx),
    excursionOptions(ctx),
    cardOptions(ctx),
  ]);
  const exc = excursions.find((e) => e.id === str(sp, "excursao"));
  const t = today(ctx);
  return (
    <>
      <PageHeader title={exc ? `Reserva na excursão ${exc.code}` : "Nova venda"} description="Preencha o essencial: parcelas, contas a pagar, comissões, reservas e contrato são preparados automaticamente." back={{ href: "/vendas", label: "Vendas" }} />
      <SaleForm
        suppliers={suppliers}
        sellers={sellers}
        canPickSeller={can(ctx, "sales.edit_all")}
        showMargin={can(ctx, "sales.view_margin")}
        rules={rules}
        excursions={excursions}
        agencyCards={agencyCards}
        initial={{
          saleDate: t,
          client,
          sellerId: ctx.userId,
          destination: exc?.destination ?? trip?.destination ?? "",
          tripStart: exc?.startDate ?? "",
          tripEnd: exc?.endDate ?? "",
          tripId: trip?.id ?? null,
          excursionId: exc?.id ?? null,
          passengerCount: 1,
          locator: "",
          notes: "",
          feesCents: 0,
          discountCents: 0,
          commission: me.commissionRateBps > 0 ? { mode: "PERCENTUAL", bps: me.commissionRateBps } : { mode: "VALOR", amountCents: 0 },
          items: exc
            ? [{ productType: "EXCURSAO", description: `${exc.code} · ${exc.name}`, supplierId: "", operatorId: "", commercialModel: "REVENDA", priceCents: exc.pricePerSeatCents, costCents: 0, supplierCommissionCents: 0, ravCents: 0, duCents: 0, overCents: 0, cardFeeCents: 0, supplierDueDate: "", locator: "" }]
            : [],
          payments: [],
          passengers: [],
          locked: {},
        }}
      />
    </>
  );
}
