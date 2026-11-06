import { orNotFound } from "@/server/page-helpers";
import { SaleForm } from "@/app/(app)/vendas/sale-form";
import { editSaleFormData } from "@/app/(app)/vendas/sale-form-data";
import type { Params } from "@/lib/params";
import { balcaoContext } from "../../shared";

/** Continuar o rascunho (ou ajustar a venda) dentro da venda rápida. */
export default async function BalcaoEditarPage({ params }: { params: Params }) {
  const { id } = await params;
  const ctx = await balcaoContext(`/balcao/${id}/editar`);
  const { sale: _sale, ...form } = await orNotFound(editSaleFormData(ctx, id));
  void _sale;
  return <SaleForm {...form} afterSaveHref="/balcao/:id" />;
}
