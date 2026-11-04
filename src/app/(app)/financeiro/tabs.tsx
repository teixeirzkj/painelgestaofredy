"use client";
import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui";

const ITEMS = [
  { key: "receber", href: "/financeiro/receber", label: "Contas a receber" },
  { key: "pagar", href: "/financeiro/pagar", label: "Contas a pagar" },
  { key: "fluxo", href: "/financeiro/fluxo", label: "Fluxo de caixa" },
  { key: "contas", href: "/financeiro/contas", label: "Contas e transferências" },
  { key: "conciliacao", href: "/financeiro/conciliacao", label: "Conciliação" },
];

export function FinanceTabs() {
  const path = usePathname();
  const active = ITEMS.find((i) => path.startsWith(i.href))?.key ?? "receber";
  return <Tabs items={ITEMS} active={active} />;
}
