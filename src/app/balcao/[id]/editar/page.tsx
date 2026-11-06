import { orNotFound } from "@/server/page-helpers";
import { SaleForm } from "@/app/(app)/vendas/sale-form";
import { editSaleFormData } from "@/app/(app)/vendas/sale-form-data";
import type { Params } from "@/lib/params";
import { balcaoContext, saleGuideFacts } from "../../shared";
import { BalcaoGuide } from "../../guide";

/** Continuar o rascunho (ou ajustar a venda) dentro da venda rápida. */
export default async function BalcaoEditarPage({ params }: { params: Params }) {
  const { id } = await params;
  const ctx = await balcaoContext(`/balcao/${id}/editar`);
  const { sale: _sale, ...form } = await orNotFound(editSaleFormData(ctx, id));
  void _sale;
  const guide = await saleGuideFacts(ctx, id, "venda");
  return (
    <div className="space-y-4">
      {guide && <BalcaoGuide facts={guide} />}
      <SaleForm {...form} afterSaveHref="/balcao/:id" />
    </div>
  );
}
