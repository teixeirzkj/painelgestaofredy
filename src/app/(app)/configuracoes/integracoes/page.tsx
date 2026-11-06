import { requirePageContext } from "@/server/auth";
import { prisma } from "@/server/db";
import { getFredyIntegration, listFredyPanels, getFredyPanelSetup, FIELD_TARGETS, publicBaseUrl } from "@/server/services/fredy";
import { headers } from "next/headers";
import { QuickSaleLink } from "./quick-sale-link";
import { PageHeader } from "@/components/ui";
import { PRODUCT_TYPES } from "@/lib/constants";
import { FredyIntegrationPanel } from "./fredy-client";

export const metadata = { title: "Integrações" };

export default async function IntegrationsPage() {
  const ctx = await requirePageContext("settings.manage");
  const integ = await getFredyIntegration(ctx);
  let panels: Awaited<ReturnType<typeof listFredyPanels>> = [];
  let setup: Awaited<ReturnType<typeof getFredyPanelSetup>> | null = null;
  let loadError: string | null = null;
  if (integ.connected) {
    try {
      panels = await listFredyPanels(ctx);
      if (integ.salesPanelId) setup = await getFredyPanelSetup(ctx, integ.salesPanelId);
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Não foi possível ler o CRM agora.";
    }
  }
  const h = await headers();
  const base = publicBaseUrl() ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const users = await prisma.user.findMany({ where: { companyId: ctx.companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader back={{ href: "/configuracoes", label: "Configurações" }} title="Integrações" description="Conecte a gestão ao CRM Frédy: card ganho vira venda, e a venda confirmada volta para o card." />
      <FredyIntegrationPanel
        integ={JSON.parse(JSON.stringify(integ))}
        panels={panels}
        setup={setup}
        loadError={loadError}
        users={users}
        productTypes={PRODUCT_TYPES.values.map((v) => ({ value: v, label: PRODUCT_TYPES.label(v) }))}
        fieldTargets={FIELD_TARGETS}
      />
      <QuickSaleLink base={base} />
    </>
  );
}
