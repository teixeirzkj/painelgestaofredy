import { requirePageContext } from "@/server/auth";
import { orNotFound } from "@/server/page-helpers";
import { can } from "@/server/context";
import { getSaleForEdit } from "@/server/services/sales";
import { supplierOptions } from "@/server/services/registry";
import { sellerOptions } from "@/server/services/settings";
import { Notice, PageHeader } from "@/components/ui";
import { SaleForm } from "../../sale-form";
import type { Params } from "@/lib/params";
import type { CommercialModel } from "@/lib/constants";

export const metadata = { title: "Editar venda" };

export default async function EditSalePage({ params }: { params: Params }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const [sale, suppliers, sellers] = await orNotFound(Promise.all([getSaleForEdit(ctx, id), supplierOptions(ctx), sellerOptions(ctx)]));
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
          commission: { mode: "VALOR", amountCents: sale.sellerCommissionCents },
          items: sale.items.map((i) => ({
            id: i.id,
            productType: i.productType,
            description: i.description ?? "",
            supplierId: i.supplierId ?? "",
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
          })),
          locked: sale.locked,
        }}
      />
    </>
  );
}
