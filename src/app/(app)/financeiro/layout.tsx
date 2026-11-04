import { requirePageContext } from "@/server/auth";
import { PageHeader } from "@/components/ui";
import { FinanceTabs } from "./tabs";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePageContext("finance.view");
  return (
    <>
      <PageHeader title="Financeiro" description="Contas a receber e a pagar, fluxo de caixa, contas financeiras e conciliação." />
      <FinanceTabs />
      {children}
    </>
  );
}
