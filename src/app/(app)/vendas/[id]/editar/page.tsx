import { requirePageContext } from "@/server/auth";
import { orNotFound } from "@/server/page-helpers";
import { Notice, PageHeader } from "@/components/ui";
import { SaleForm } from "../../sale-form";
import { editSaleFormData } from "../../sale-form-data";
import type { Params } from "@/lib/params";

export const metadata = { title: "Editar venda" };

export default async function EditSalePage({ params }: { params: Params }) {
  const ctx = await requirePageContext();
  const { id } = await params;
  const { sale, ...form } = await orNotFound(editSaleFormData(ctx, id));
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
      <SaleForm {...form} />
    </>
  );
}
