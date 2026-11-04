"use client";
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { ConfirmDialog, Modal } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { deleteCommissionRuleAction, saveCommissionRuleAction, saveCostCenterAction } from "@/app/actions";
import { PRODUCT_TYPES } from "@/lib/constants";
import { formatPercentBps } from "@/lib/money";

type Rule = { id: string; supplierId: string | null; supplier?: { name: string } | null; productType: string | null; description: string | null; commissionBps: number; overBps: number; active: boolean };
type Opt = { id: string; name: string };

/** Regras de comissão/over por fornecedor e produto (sugeridas automaticamente na venda). */
export function CommissionRulesEditor({ rules, suppliers, fixedSupplierId, canManage }: { rules: Rule[]; suppliers?: Opt[]; fixedSupplierId?: string; canManage: boolean }) {
  const { run, busy } = useAction();
  const blank = { id: null as string | null, supplierId: fixedSupplierId ?? "", productType: "", description: "", commission: "0", over: "0", active: true };
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pct = (v: string) => Math.round(Number(String(v).replace(",", ".")) * 100) || 0;

  return (
    <div>
      {rules.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">Nenhuma regra. Cadastre o percentual de comissão e de over para preenchimento automático nas vendas.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">
                  {!fixedSupplierId && (r.supplier?.name ?? "Qualquer fornecedor")}
                  {!fixedSupplierId && " · "}
                  {r.productType ? PRODUCT_TYPES.label(r.productType) : "Todos os produtos"}
                  {r.description && <span className="font-normal text-muted"> · {r.description}</span>}
                </span>
                <span className="text-xs text-muted">
                  comissão {formatPercentBps(r.commissionBps)} · over {formatPercentBps(r.overBps)}
                </span>
              </span>
              {!r.active && <Badge>inativa</Badge>}
              {canManage && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Editar regra"
                    onClick={() => {
                      setF({ id: r.id, supplierId: r.supplierId ?? "", productType: r.productType ?? "", description: r.description ?? "", commission: String(r.commissionBps / 100), over: String(r.overBps / 100), active: r.active });
                      setOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label="Excluir regra" onClick={() => setDel(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="border-t border-line px-5 py-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setF(blank);
              setErrors({});
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Nova regra
          </Button>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={f.id ? "Editar regra de comissão" : "Nova regra de comissão"}
        description="Aplicada como sugestão ao escolher fornecedor e produto na venda. O valor pode ser ajustado em cada venda."
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              loading={busy}
              onClick={async () => {
                const r = await run(
                  () =>
                    saveCommissionRuleAction(f.id, {
                      supplierId: f.supplierId || null,
                      productType: f.productType || null,
                      description: f.description,
                      commissionBps: pct(f.commission),
                      overBps: pct(f.over),
                      active: f.active,
                    }),
                  { onSuccess: () => setOpen(false) },
                );
                if (!r.ok) setErrors(issuesToMap(r.issues));
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {!fixedSupplierId && (
            <Field label="Fornecedor" error={errors.supplierId}>
              <Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
                <option value="">Qualquer fornecedor</option>
                {suppliers?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Produto" error={fixedSupplierId ? errors.supplierId : undefined}>
            <Select value={f.productType} onChange={(e) => setF({ ...f, productType: e.target.value })}>
              <option value="">Todos os produtos</option>
              {PRODUCT_TYPES.values.map((v) => (
                <option key={v} value={v}>
                  {PRODUCT_TYPES.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Descrição" hint="Ex.: Nacional, Internacional" className={fixedSupplierId ? "" : "sm:col-span-2"}>
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <Field label="Comissão do fornecedor (%)" hint="sobre o valor do produto">
            <Input inputMode="decimal" value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} className="text-right" />
          </Field>
          <Field label="Over / incentivo (%)">
            <Input inputMode="decimal" value={f.over} onChange={(e) => setF({ ...f, over: e.target.value })} className="text-right" />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="accent-brand-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Regra ativa
          </label>
        </div>
      </Modal>
      <ConfirmDialog
        open={!!del}
        onClose={() => setDel(null)}
        title="Excluir regra?"
        description="Vendas já registradas não são alteradas."
        confirmLabel="Excluir"
        onConfirm={async () => {
          await run(() => deleteCommissionRuleAction(del!), { onSuccess: () => setDel(null) });
        }}
      />
    </div>
  );
}

export function CostCentersEditor({ items, canManage }: { items: { id: string; name: string; active: boolean }[]; canManage: boolean }) {
  const { run, busy } = useAction();
  const [name, setName] = useState("");
  return (
    <div>
      {items.length === 0 ? (
        <p className="px-5 py-5 text-sm text-muted">Nenhum centro de custo. Exemplos: Loja física, Marketing digital, Excursões, Corporativo.</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
              <span className={c.active ? "font-medium text-ink" : "text-muted line-through"}>{c.name}</span>
              {canManage && (
                <Button variant="ghost" size="sm" loading={busy} onClick={() => run(() => saveCostCenterAction(c.id, { name: c.name, active: !c.active }))}>
                  {c.active ? "Desativar" : "Reativar"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="flex gap-2 border-t border-line px-5 py-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => saveCostCenterAction(null, { name, active: true }));
            if (r.ok) setName("");
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Novo centro de custo" className="h-8 text-sm" />
          <Button size="sm" type="submit" loading={busy} disabled={name.trim().length < 2}>
            <Plus className="h-4 w-4" /> Adicionar
          </Button>
        </form>
      )}
    </div>
  );
}
