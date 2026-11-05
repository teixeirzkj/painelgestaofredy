import Link from "next/link";
import { requirePageContext } from "@/server/auth";
import { can } from "@/server/context";
import { listExpenseCategories } from "@/server/services/admin";
import { Badge, Card, PageHeader } from "@/components/ui";
import { FilterForm, FilterSearch } from "@/components/filter-form";
import { str, withParams, type SearchParams } from "@/lib/params";
import { cn } from "@/lib/utils";
import { CategoryEditor } from "./categories-client";

export const metadata = { title: "Categorias de despesa" };

export default async function CategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requirePageContext("finance.view");
  const sp = await searchParams;
  const q = (str(sp, "q") ?? "").toLowerCase();
  const view = str(sp, "ver");
  const groups = await listExpenseCategories(ctx);
  const all = groups.flatMap((g) => g.items);
  const canEdit = can(ctx, "finance.manage");
  const groupNames = groups.map((g) => g.name);
  const filtered = groups.map((g) => ({
    ...g,
    shown: g.items.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (view === "dre" ? c.inDre : view === "fora" ? !c.inDre : true)),
  }));
  const tabs = [
    { key: "", label: "Todas", count: all.length },
    { key: "dre", label: "No DRE", count: all.filter((c) => c.inDre).length },
    { key: "fora", label: "Fora do DRE", count: all.filter((c) => !c.inDre).length },
  ];

  return (
    <>
      <PageHeader
        back={{ href: "/configuracoes", label: "Configurações" }}
        title="Categorias de despesa"
        description={`${all.length} categorias em ${groups.length} grupos. Os valores de cada grupo aparecem no DRE.`}
        actions={canEdit && <CategoryEditor trigger="new" groups={groupNames} />}
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <FilterForm className="flex-1">
          <FilterSearch value={str(sp, "q")} placeholder="Buscar categoria" />
          {view && <input type="hidden" name="ver" value={view} />}
        </FilterForm>
        <div className="flex rounded-xl border border-line bg-white p-1">
          {tabs.map((t) => (
            <Link key={t.key} href={withParams("/configuracoes/categorias", sp, { ver: t.key || undefined })} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium", (view ?? "") === t.key ? "bg-brand-50 text-brand-700" : "text-muted hover:text-ink")}>
              {t.label} <span className="text-xs text-subtle">{t.count}</span>
            </Link>
          ))}
        </div>
      </div>
      <Card className="grid overflow-hidden sm:grid-cols-2 xl:grid-cols-3 [&>*]:border-b [&>*]:border-line sm:[&>*]:border-r">
        {filtered.map((g) => (
          <div key={g.name} className="flex flex-col p-5">
            <div className="mb-3 flex items-center gap-2 border-b border-line pb-3">
              <h3 className="font-semibold text-ink">{g.name}</h3>
              <span className="rounded-full bg-slate-100 px-2 text-xs text-slate-600">{g.items.length}</span>
            </div>
            <ul className="flex-1 space-y-1.5">
              {g.shown.length === 0 && <li className="text-sm text-muted">Nenhuma categoria{q || view ? " neste filtro" : " neste grupo"}.</li>}
              {g.shown.map((c) => (
                <li key={c.id} className="group flex items-center gap-2 text-sm">
                  <span className={cn("flex-1", !c.active && "text-subtle line-through", !c.inDre && c.active && "text-muted")}>{c.name}</span>
                  {!c.inDre && <Badge className="py-0 text-[10px]">Fora do DRE</Badge>}
                  {c.system && <Badge tone="blue" className="py-0 text-[10px]">Automática</Badge>}
                  {canEdit && <CategoryEditor trigger="edit" category={c} groups={groupNames} />}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-3">
                <CategoryEditor trigger="add" group={g.name} groups={groupNames} />
              </div>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}
