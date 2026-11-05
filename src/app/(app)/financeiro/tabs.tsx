"use client";
import { usePathname } from "next/navigation";
import { PageHeader } from "@/components/ui";

/** Título das telas do financeiro que não montam o próprio cabeçalho. */
const TITLES: Record<string, { title: string; description: string }> = {
  "/financeiro/faturas": { title: "Faturas do fornecedor", description: "Faturas de operadoras e consolidadoras: conferência com o sistema, divergências e quitação em uma única operação." },
  "/financeiro/fluxo": { title: "Fluxo de caixa", description: "Entradas e saídas previstas e realizadas por dia, semana ou mês." },
  "/financeiro/contas": { title: "Contas e saldos", description: "Contas bancárias, caixa e recebíveis, com saldos e transferências." },
  "/financeiro/conciliacao": { title: "Conciliação bancária", description: "Importe o extrato e vincule cada linha às baixas registradas no sistema." },
};

export function FinanceHeader() {
  const path = usePathname();
  const t = TITLES[path];
  if (!t) return null;
  return <PageHeader title={t.title} description={t.description} />;
}
