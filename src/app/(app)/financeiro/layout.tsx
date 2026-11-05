import { requirePageContext } from "@/server/auth";
import { FinanceHeader } from "./tabs";

/** O menu lateral já leva a cada tela do financeiro; aqui só validamos o acesso e mostramos o título das telas sem cabeçalho próprio. */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requirePageContext("finance.view");
  return (
    <>
      <FinanceHeader />
      {children}
    </>
  );
}
