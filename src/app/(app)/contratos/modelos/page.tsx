import { requirePageContext } from "@/server/auth";
import { CONTRACT_VARIABLES, listTemplates } from "@/server/services/contracts";
import { PageHeader } from "@/components/ui";
import { TemplatesEditor } from "./templates-editor";

export const metadata = { title: "Modelos de contrato" };

export default async function TemplatesPage() {
  const ctx = await requirePageContext("settings.manage");
  const templates = await listTemplates(ctx);
  return (
    <>
      <PageHeader title="Modelos de contrato" description="Um modelo por tipo de produto, com cláusulas específicas de cancelamento e alteração." back={{ href: "/contratos", label: "Contratos" }} />
      <TemplatesEditor
        templates={templates.map((t) => ({ id: t.id, name: t.name, productType: t.productType, body: t.body, clauses: t.clauses, active: t.active, version: t.version }))}
        variables={CONTRACT_VARIABLES}
      />
    </>
  );
}
