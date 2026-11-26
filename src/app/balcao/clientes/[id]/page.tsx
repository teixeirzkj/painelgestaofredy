import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserRound } from "lucide-react";
import { prisma } from "@/server/db";
import { can, today } from "@/server/context";
import { clientScope } from "@/server/services/registry";
import { clientMissing, clientWarnings } from "@/server/services/balcao";
import { Card } from "@/components/ui";
import { EditClientButton } from "@/app/(app)/clientes/client-buttons";
import { ClientDocuments } from "@/app/(app)/clientes/[id]/client-documents";
import { clientDocHint } from "@/lib/client-identity";
import type { Params } from "@/lib/params";
import { balcaoContext } from "../../shared";
import { BalcaoHeader, ModeTabs } from "../../header";
import { StartFlowButton } from "./start-flow-button";

export const metadata = { title: "Cliente" };

/** Popup: ficha de um cliente fora do atendimento (conferir, editar, anexar documentos ou iniciar o atendimento). */
export default async function BalcaoClientePage({ params }: { params: Params }) {
  const { id } = await params;
  const ctx = await balcaoContext(`/balcao/clientes/${id}`);
  const client = await prisma.client.findFirst({
    where: { AND: [{ id }, clientScope(ctx), { archivedAt: null }] },
    include: { attachments: { orderBy: { createdAt: "desc" }, select: { id: true, kind: true, fileName: true, mimeType: true, docNumber: true, docExpiry: true, createdAt: true } } },
  });
  if (!client) notFound();
  const missing = [...clientMissing(client), ...clientWarnings(client)];
  const canManage = can(ctx, "clients.manage");
  return (
    <>
      <BalcaoHeader ctx={ctx} view={0} done={[]} showSteps={false} />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <ModeTabs active="clientes" />
        <Link href="/balcao/clientes" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Voltar para a busca
        </Link>
        <Card>
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-25 text-brand-700">
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">{client.name}</p>
              <p className="text-sm text-muted">{[clientDocHint(client), client.whatsapp || client.phone, client.email].filter(Boolean).join(" · ") || "sem documento e contato"}</p>
              <p className="text-xs text-muted">{[client.street, client.number, client.district, client.city, client.state].filter(Boolean).join(", ") || "sem endereço"}</p>
            </div>
            {canManage && <EditClientButton id={client.id} initial={client} />}
          </div>
          {missing.length > 0 && <p className="border-t border-line bg-slate-50 px-5 py-2 text-sm text-slate-600">Falta no cadastro: <strong>{missing.join(" e ")}</strong>. Não impede de salvar; o contrato vai pedir quando houver venda.</p>}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4">
            <p className="flex-1 text-xs text-muted">O cliente fica salvo na gestão. Se ele fechar a viagem, inicie o atendimento a partir daqui.</p>
            {can(ctx, "sales.create") && <StartFlowButton clientId={client.id} />}
          </div>
        </Card>
        <Card>
          <div className="border-b border-line px-5 py-3">
            <p className="font-semibold text-ink">Documentos do cliente</p>
            <p className="text-xs text-muted">Fotos ou PDF de RG, CPF, CNH, passaporte ou RNE.</p>
          </div>
          <ClientDocuments clientId={client.id} docs={client.attachments} canManage={canManage} todayStr={today(ctx)} />
        </Card>
      </main>
    </>
  );
}
