import { can } from "@/server/context";
import { balcaoContext } from "../shared";
import { BalcaoHeader, ModeTabs } from "../header";
import { ClientsDesk } from "./clients-desk";

export const metadata = { title: "Clientes" };

/** Popup: área de clientes. Busca, cadastra e atualiza clientes sem abrir atendimento, venda ou contrato. */
export default async function BalcaoClientesPage() {
  const ctx = await balcaoContext("/balcao/clientes");
  return (
    <>
      <BalcaoHeader ctx={ctx} view={0} done={[]} showSteps={false} />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <ModeTabs active="clientes" />
        <ClientsDesk canCreate={can(ctx, "clients.manage")} />
      </main>
    </>
  );
}
