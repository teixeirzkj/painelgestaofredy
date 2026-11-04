import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { prisma } from "@/server/db";
import { supplierOptions } from "@/server/services/registry";
import { sellerOptions } from "@/server/services/settings";
import { PageHeader } from "@/components/ui";
import { SaleForm } from "../sale-form";
import { str, type SearchParams } from "@/lib/params";
import { clientScope } from "@/server/services/registry";

export const metadata = { title: "Nova venda" };

export default async function NewSalePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("sales.create");
  const sp = await searchParams;
  const clientId = str(sp, "cliente");
  const [suppliers, sellers, me, client] = await Promise.all([
    supplierOptions(ctx),
    sellerOptions(ctx),
    prisma.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { commissionRateBps: true } }),
    clientId ? prisma.client.findFirst({ where: { AND: [{ id: clientId }, clientScope(ctx)] }, select: { id: true, name: true, document: true, whatsapp: true } }) : null,
  ]);
  const t = today(ctx);
  return (
    <>
      <PageHeader title="Nova venda" description="Preencha o essencial. O restante da operação é preparado automaticamente." back={{ href: "/vendas", label: "Vendas" }} />
      <SaleForm
        suppliers={suppliers}
        sellers={sellers}
        canPickSeller={can(ctx, "sales.edit_all")}
        showMargin={can(ctx, "sales.view_margin")}
        initial={{
          saleDate: t,
          client,
          sellerId: ctx.userId,
          destination: "",
          tripStart: "",
          tripEnd: "",
          passengerCount: 1,
          locator: "",
          notes: "",
          feesCents: 0,
          discountCents: 0,
          commission: me.commissionRateBps > 0 ? { mode: "PERCENTUAL", bps: me.commissionRateBps } : { mode: "VALOR", amountCents: 0 },
          items: [],
          payments: [],
          passengers: [],
          locked: {},
        }}
      />
    </>
  );
}
