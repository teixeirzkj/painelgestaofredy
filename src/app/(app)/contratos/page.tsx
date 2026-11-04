import Link from "next/link";
import { FileSignature, Settings2 } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listContracts } from "@/server/services/contracts";
import { Card, EmptyState, LinkButton, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterForm, FilterSearch, FilterSelect } from "@/components/filter-form";
import { ContractStatusBadge } from "@/components/status";
import { CONTRACT_STATUS, PRODUCT_TYPES } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import { str, type SearchParams } from "@/lib/params";

export const metadata = { title: "Contratos" };

export default async function ContractsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("contracts.manage");
  const sp = await searchParams;
  const status = str(sp, "status");
  const q = str(sp, "q");
  const items = await listContracts(ctx, { status, q });
  return (
    <>
      <PageHeader
        title="Contratos"
        description="Gerados automaticamente a partir das vendas confirmadas."
        actions={
          can(ctx, "settings.manage") && (
            <LinkButton href="/contratos/modelos" variant="outline">
              <Settings2 className="h-4 w-4" /> Modelos
            </LinkButton>
          )
        }
      />
      <div className="mb-4">
        <Notice title="Assinatura eletrônica: integração pendente">
          A estrutura está pronta (estados, webhook seguro e adaptador), mas nenhum provedor de assinatura foi contratado/configurado. Os status “Enviado” e “Assinado” só mudam
          mediante confirmação do provedor — o sistema não simula assinatura. Enquanto isso, emita o PDF e colete a assinatura pelo processo atual da agência.
        </Notice>
      </div>
      <Card>
        <div className="border-b border-line p-3">
          <FilterForm>
            <FilterSearch value={q} placeholder="Código da venda ou cliente" />
            <FilterSelect name="status" label="Status" value={status} options={CONTRACT_STATUS.values.map((v) => ({ value: v, label: CONTRACT_STATUS.label(v) }))} />
          </FilterForm>
        </div>
        {items.length === 0 ? (
          <EmptyState icon={FileSignature} title="Nenhum contrato" description="Ao confirmar uma venda, o contrato é preparado automaticamente com os dados do cliente e da viagem." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Venda</Th>
                <Th>Cliente</Th>
                <Th>Produto</Th>
                <Th>Modelo</Th>
                <Th>Versão</Th>
                <Th>Atualizado</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => {
                const missing = JSON.parse(c.missingFieldsJson) as string[];
                return (
                  <tr key={c.id} className="hover:bg-slate-50/60">
                    <Td>
                      <Link href={`/contratos/${c.id}`} className="font-medium text-brand-700 hover:underline">
                        {c.sale.code}
                      </Link>
                    </Td>
                    <Td className="max-w-48 truncate">{c.sale.client.name}</Td>
                    <Td className="text-slate-600">{PRODUCT_TYPES.label(c.sale.mainProductType)}</Td>
                    <Td className="text-slate-600">{c.template?.name ?? "—"}</Td>
                    <Td>{c.version || "—"}</Td>
                    <Td className="text-slate-600">{formatDateTime(c.updatedAt, ctx.timezone)}</Td>
                    <Td>
                      <ContractStatusBadge s={c.status} />
                      {missing.length > 0 && c.status === "EM_PREPARACAO" && <p className="mt-0.5 text-xs text-amber-700">{missing.length} dado(s) pendente(s)</p>}
                      {c.outdated && <p className="mt-0.5 text-xs text-amber-700">Venda alterada após emissão</p>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
