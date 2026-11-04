import { requirePageContext } from "@/server/auth";
import { prisma } from "@/server/db";
import { orNotFound } from "@/server/page-helpers";
import { can } from "@/server/context";
import { getSaleForEdit } from "@/server/services/sales";
import { supplierOptions } from "@/server/services/registry";
import { sellerOptions } from "@/server/services/settings";
import { activeRules } from "@/server/services/catalog";
import { excursionOptions } from "@/server/services/excursions";
import { Notice, PageHeader } from "@/components/ui";
import { SaleForm } from "../../sale-form";
import type { Params } from "@/lib/params";
import type { CommercialModel } from "@/lib/constants";

export const metadata = { title: "Editar venda" };

export default async function EditSalePage({ params }: { params: Params }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const [sale, suppliers, sellers, rules, excursions] = await orNotFound(Promise.all([getSaleForEdit(ctx, id), supplierOptions(ctx), sellerOptions(ctx), activeRules(ctx), excursionOptions(ctx)]));
  // a excursão da própria venda continua disponível mesmo se já tiver encerrado as vendas
  if (sale.excursionId && !excursions.some((e) => e.id === sale.excursionId)) {
    const own = await prisma.excursion.findFirst({ where: { id: sale.excursionId, companyId: ctx.companyId }, select: { id: true, code: true, name: true, destination: true, startDate: true, endDate: true, pricePerSeatCents: true, seats: true } });
    if (own) excursions.push(own);
  }
  const hasLocked = Object.keys(sale.locked).length > 0;
  return (
    <>
      <PageHeader title={`Editar ${sale.code}`} description={sale.client.name} back={{ href: `/vendas/${id}`, label: "Voltar à venda" }} />
      {sale.status !== "ORCAMENTO" && (
        <div className="mb-6">
          <Notice title="Venda confirmada">
            As alterações atualizam automaticamente parcelas, contas a pagar e comissão. Recebimentos e pagamentos já baixados são preservados
            {hasLocked ? "; parcelas com recebimento ficam travadas (cadeado) e não podem ser reduzidas abaixo do valor recebido." : "."}
          </Notice>
        </div>
      )}
      <SaleForm
        suppliers={suppliers}
        sellers={sellers}
        canPickSeller={can(ctx, "sales.edit_all")}
        showMargin={can(ctx, "sales.view_margin")}
        rules={rules}
        excursions={excursions}
        initial={{
          id: sale.id,
          code: sale.code,
          status: sale.status,
          saleDate: sale.saleDate,
          client: sale.client,
          sellerId: sale.sellerId,
          destination: sale.destination ?? "",
          tripStart: sale.tripStart ?? "",
          tripEnd: sale.tripEnd ?? "",
          passengerCount: sale.passengerCount,
          locator: sale.locator ?? "",
          notes: sale.notes ?? "",
          feesCents: sale.feesCents,
          discountCents: sale.discountCents,
          tripId: sale.tripId,
          excursionId: sale.excursionId,
          intermediaryId: sale.intermediaryId,
          intermediaryCommissionCents: sale.intermediaryCommissionCents,
          people: sale.people,
          commission: { mode: "VALOR", amountCents: sale.sellerCommissionCents },
          items: sale.items.map((i) => ({
            id: i.id,
            productType: i.productType,
            description: i.description ?? "",
            supplierId: i.supplierId ?? "",
            operatorId: i.operatorId ?? "",
            ravCents: i.ravCents,
            duCents: i.duCents,
            overCents: i.overCents,
            cardFeeCents: i.cardFeeCents,
            commercialModel: i.commercialModel as CommercialModel,
            priceCents: i.priceCents,
            costCents: i.costCents,
            supplierCommissionCents: i.supplierCommissionCents,
            supplierDueDate: i.supplierDueDate ?? "",
            locator: i.locator ?? "",
          })),
          payments: sale.plan,
          passengers: sale.passengers.map((p) => ({
            name: p.name,
            document: p.document ?? "",
            birthDate: p.birthDate ?? "",
            passportNumber: p.passportNumber ?? "",
            passportExpiry: p.passportExpiry ?? "",
            clientId: p.clientId,
            room: p.room,
            seat: p.seat,
          })),
          locked: sale.locked,
        }}
      />
    </>
  );
}
