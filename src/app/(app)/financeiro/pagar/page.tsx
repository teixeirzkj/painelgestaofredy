import { requirePageContext } from "@/server/auth";
import type { SearchParams } from "@/lib/params";
import { EntriesView } from "../entries-view";

export const metadata = { title: "Contas a pagar" };

export default async function PayablesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  return <EntriesView ctx={ctx} kind="payable" sp={await searchParams} />;
}
