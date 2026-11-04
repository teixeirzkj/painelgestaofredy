import { requirePageContext } from "@/server/auth";
import type { SearchParams } from "@/lib/params";
import { EntriesView } from "../entries-view";

export const metadata = { title: "Contas a receber" };

export default async function ReceivablesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  return <EntriesView ctx={ctx} kind="receivable" sp={await searchParams} />;
}
