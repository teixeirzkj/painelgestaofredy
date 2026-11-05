"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, Field, Select } from "@/components/ui";
import { MoneyInput } from "@/components/ui/client";
import { ProgressBar } from "@/components/ui";
import { useAction } from "@/components/use-action";
import { saveGoalAction } from "@/app/actions";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Seller = { id: string; name: string; goalCents: number; metric: string; realized: number; count: number };
type Sup = { id: string; name: string; goalCents: number; realized: number };

function Pct({ value, max }: { value: number; max: number }) {
  if (!max) return <span className="text-xs text-muted">sem meta</span>;
  const p = Math.round((value / max) * 100);
  return <span className={cn("text-sm font-semibold tabular", p >= 100 ? "text-success" : "text-ink")}>{p}%</span>;
}

export function GoalsClient({
  month,
  monthName,
  canEdit,
  initialTab,
  store,
  sellers,
  suppliers,
  supplierOptions,
  withoutGoal,
}: {
  month: string;
  monthName: string;
  canEdit: boolean;
  initialTab: "loja" | "vendedores";
  store: { amountCents: number; superAmountCents: number; metric: string } | null;
  sellers: Seller[];
  suppliers: Sup[];
  supplierOptions: { id: string; name: string }[];
  withoutGoal: number;
}) {
  const { run, busy } = useAction();
  const [tab, setTab] = useState(initialTab);
  const [metric, setMetric] = useState(store?.metric ?? "FATURAMENTO");
  const [amount, setAmount] = useState(store?.amountCents ?? 0);
  const [superAmount, setSuperAmount] = useState(store?.superAmountCents ?? 0);
  const [sellerValues, setSellerValues] = useState<Record<string, number>>(Object.fromEntries(sellers.map((s) => [s.id, s.goalCents])));
  const [newSup, setNewSup] = useState({ id: "", amount: 0 });

  const save = (scope: "LOJA" | "VENDEDOR" | "FORNECEDOR", targetId: string, amountCents: number, extra: Record<string, unknown> = {}) =>
    run(() => saveGoalAction({ month, scope, targetId, amountCents, metric: scope === "LOJA" ? metric : "FATURAMENTO", ...extra }));

  const tabBtn = (key: "loja" | "vendedores", label: React.ReactNode) => (
    <button onClick={() => setTab(key)} className={cn("inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors", tab === key ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")}>
      {label}
    </button>
  );

  return (
    <>
      <div className="mb-4 inline-flex rounded-xl border border-line bg-slate-50 p-1">
        {tabBtn("loja", "Meta da loja")}
        {tabBtn(
          "vendedores",
          <>
            Vendedores {withoutGoal > 0 && <Badge tone="amber">{withoutGoal} sem meta</Badge>}
          </>,
        )}
      </div>

      {tab === "loja" ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[15px] font-semibold">Meta de {monthName}</h3>
            <label className="flex items-center gap-2 text-sm text-muted">
              Medida
              <Select value={metric} onChange={(e) => setMetric(e.target.value)} disabled={!canEdit} className="w-auto">
                <option value="FATURAMENTO">Faturamento</option>
                <option value="RECEITA">Receita da agência</option>
              </Select>
            </label>
          </div>
          {canEdit ? (
            <div className="mt-4 grid gap-4 rounded-xl border border-dashed border-line-strong p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field label="Meta do mês" hint="Informe 0 para remover a meta.">
                <MoneyInput
                  value={amount}
                  onChange={(v) => {
                    setAmount(v);
                    setSuperAmount(Math.round(v * 1.5));
                  }}
                />
              </Field>
              <Field label="Super meta" hint="Sugerida em 150% da meta.">
                <MoneyInput value={superAmount} onChange={setSuperAmount} />
              </Field>
              <Button loading={busy} onClick={() => save("LOJA", "", amount, { superAmountCents: superAmount })}>
                {store ? "Atualizar meta" : "Definir meta"}
              </Button>
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-line-strong p-4 text-sm text-muted">{store ? `Meta definida: ${formatBRL(store.amountCents)}.` : "Nenhuma meta definida. Fale com o gestor da agência."}</p>
          )}

          <div className="mt-6 border-t border-line pt-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">Por fornecedor</h4>
            </div>
            {suppliers.length === 0 && <p className="mt-2 text-sm text-muted">Sem metas por fornecedor neste mês. Acompanhe as operadoras com uma meta própria para cada uma.</p>}
            <ul className="mt-3 space-y-3">
              {suppliers.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-4 py-3">
                  <span className="min-w-40 flex-1">
                    <span className="block text-sm font-medium text-ink">{s.name}</span>
                    <span className="block text-xs text-muted">
                      {formatBRL(s.realized)} de {formatBRL(s.goalCents)}
                    </span>
                  </span>
                  <ProgressBar value={s.realized} max={s.goalCents} tone={s.realized >= s.goalCents ? "green" : "blue"} className="w-40" />
                  <Pct value={s.realized} max={s.goalCents} />
                  {canEdit && (
                    <Button variant="ghost" size="sm" aria-label="Remover meta" onClick={() => save("FORNECEDOR", s.id, 0)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Fornecedor" className="min-w-56">
                  <Select value={newSup.id} onChange={(e) => setNewSup({ ...newSup, id: e.target.value })}>
                    <option value="">Selecione…</option>
                    {supplierOptions
                      .filter((o) => !suppliers.some((s) => s.id === o.id))
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Meta">
                  <MoneyInput value={newSup.amount} onChange={(v) => setNewSup({ ...newSup, amount: v })} />
                </Field>
                <Button
                  variant="secondary"
                  disabled={!newSup.id || !newSup.amount}
                  loading={busy}
                  onClick={async () => {
                    const r = await save("FORNECEDOR", newSup.id, newSup.amount);
                    if (r.ok) setNewSup({ id: "", amount: 0 });
                  }}
                >
                  <Plus className="h-4 w-4" /> Adicionar fornecedor
                </Button>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {sellers.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted">Nenhum vendedor ativo.</li>}
            {sellers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span className="min-w-44 flex-1">
                  <span className="block text-sm font-semibold text-ink">{s.name}</span>
                  <span className="block text-xs text-muted">
                    {formatBRL(s.realized)} vendidos · {s.count} venda(s)
                  </span>
                </span>
                <div className="flex w-56 items-center gap-2">
                  <ProgressBar value={s.realized} max={s.goalCents} tone={s.goalCents && s.realized >= s.goalCents ? "green" : "blue"} />
                  <Pct value={s.realized} max={s.goalCents} />
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-2">
                    <MoneyInput value={sellerValues[s.id] ?? 0} onChange={(v) => setSellerValues({ ...sellerValues, [s.id]: v })} className="w-40" aria-label={`Meta de ${s.name}`} />
                    <Button variant="outline" size="sm" loading={busy} disabled={(sellerValues[s.id] ?? 0) === s.goalCents} onClick={() => save("VENDEDOR", s.id, sellerValues[s.id] ?? 0)}>
                      Salvar
                    </Button>
                  </div>
                ) : (
                  <span className="w-40 text-right text-sm font-medium tabular">{s.goalCents ? formatBRL(s.goalCents) : "sem meta"}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
