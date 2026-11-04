import Link from "next/link";
import { Building2 } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listSuppliers } from "@/server/services/registry";
import { Card, EmptyState, PageHeader, Table, Td, Th, Badge } from "@/components/ui";
import { FilterForm, FilterSearch, FilterSelect } from "@/components/filter-form";
import { formatBRL } from "@/lib/money";
import { SUPPLIER_CATEGORIES } from "@/lib/constants";
import { formatDocument } from "@/lib/utils";
import { str, type SearchParams } from "@/lib/params";
import { SupplierButton } from "./supplier-form";

export const metadata = { title: "Fornecedores" };

export default async function SuppliersPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("suppliers.view");
  const sp = await searchParams;
  const q = str(sp, "q");
  const category = str(sp, "categoria");
  const items = await listSuppliers(ctx, { q, category });
  const showFinance = can(ctx, "finance.view");
  return (
    <>
      <PageHeader title="Fornecedores" description="Operadoras, companhias aéreas, hotéis, seguradoras e demais parceiros." actions={can(ctx, "suppliers.manage") && <SupplierButton />} />
      <Card>
        <div className="border-b border-line p-3">
          <FilterForm>
            <FilterSearch value={q} placeholder="Nome ou CNPJ" />
            <FilterSelect name="categoria" label="Categoria" value={category} options={SUPPLIER_CATEGORIES.values.map((v) => ({ value: v, label: SUPPLIER_CATEGORIES.label(v) }))} all="Todas" />
          </FilterForm>
        </div>
        {items.length === 0 ? (
          <EmptyState icon={Building2} title="Nenhum fornecedor" description="Cadastre os fornecedores para vincular aos produtos das vendas e gerar as contas a pagar." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fornecedor</Th>
                <Th>Categoria</Th>
                <Th>Contato</Th>
                <Th align="right">Itens vendidos</Th>
                <Th align="right">Valor negociado</Th>
                {showFinance && <Th align="right">A pagar</Th>}
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <Td>
                    <Link href={`/fornecedores/${s.id}`} className="font-medium text-brand-700 hover:underline">
                      {s.name}
                    </Link>
                    {s.document && <p className="text-xs text-muted">{formatDocument(s.document)}</p>}
                  </Td>
                  <Td>
                    <Badge>{SUPPLIER_CATEGORIES.label(s.category)}</Badge>
                  </Td>
                  <Td className="text-slate-600">
                    {s.contactName ?? "—"}
                    <p className="text-xs text-muted">{[s.phone, s.email].filter(Boolean).join(" · ")}</p>
                  </Td>
                  <Td align="right">{s.salesCount}</Td>
                  <Td align="right">{formatBRL(s.negotiatedCents)}</Td>
                  {showFinance && <Td align="right" className="font-medium">{formatBRL(s.openCents ?? 0)}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
