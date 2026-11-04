"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Search, UserPlus, Lock, Wand2, Info, CheckCircle2, Users, Package, Wallet, CreditCard } from "lucide-react";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal, MoneyInput } from "@/components/ui/client";
import { ClientForm } from "@/components/forms/client-form";
import { useAction, issuesToMap } from "@/components/use-action";
import { createSaleAction, searchClientsAction, updateSaleAction } from "@/app/actions";
import { calculateSale } from "@/lib/finance";
import { formatBRL, formatPercentBps, splitInstallments, sum } from "@/lib/money";
import { addMonths } from "@/lib/dates";
import { COMMERCIAL_MODELS, COMMERCIAL_MODEL_HELP, PAYMENT_METHODS, PRODUCT_TYPES, type CommercialModel } from "@/lib/constants";
import { cn, formatDocument, newKey } from "@/lib/utils";

type Item = {
  uid: string;
  id?: string | null;
  productType: string;
  description: string;
  supplierId: string;
  commercialModel: CommercialModel;
  priceCents: number;
  costCents: number;
  supplierCommissionCents: number;
  supplierDueDate: string;
  locator: string;
};
type Payment = { key: string; dueDate: string; amountCents: number; method: string; description?: string | null };
type Passenger = { uid: string; name: string; document: string; birthDate: string; passportNumber: string; passportExpiry: string };
type ClientRef = { id: string; name: string; document?: string | null; whatsapp?: string | null };

export type SaleFormInitial = {
  id?: string;
  status?: string;
  code?: string;
  saleDate: string;
  client: ClientRef | null;
  sellerId: string;
  destination: string;
  tripStart: string;
  tripEnd: string;
  passengerCount: number;
  locator: string;
  notes: string;
  feesCents: number;
  discountCents: number;
  commission: { mode: "VALOR"; amountCents: number } | { mode: "PERCENTUAL"; bps: number };
  items: Omit<Item, "uid">[];
  payments: Payment[];
  passengers: Omit<Passenger, "uid">[];
  locked: Record<string, number>;
};

const blankItem = (): Item => ({
  uid: newKey(),
  productType: "PACOTE",
  description: "",
  supplierId: "",
  commercialModel: "INTERMEDIACAO",
  priceCents: 0,
  costCents: 0,
  supplierCommissionCents: 0,
  supplierDueDate: "",
  locator: "",
});

function Section({ icon: Icon, title, description, children, aside }: { icon: React.ElementType; title: string; description?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

function ClientPicker({ value, onChange, error }: { value: ClientRef | null; onChange: (c: ClientRef | null) => void; error?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ClientRef[]>([]);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await searchClientsAction(q);
      if (r.ok) setResults(r.data);
    }, 200);
    return () => clearTimeout(timer.current);
  }, [q, open]);

  if (value)
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{value.name}</p>
          <p className="text-xs text-muted">{[value.document && formatDocument(value.document), value.whatsapp].filter(Boolean).join(" · ") || "Sem documento cadastrado"}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className={cn("pl-9", error && "border-danger")}
            placeholder="Buscar por nome, CPF ou WhatsApp…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            aria-label="Buscar cliente"
          />
        </div>
        <Button type="button" variant="secondary" onClick={() => setCreating(true)}>
          <UserPlus className="h-4 w-4" /> Novo
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">Nenhum cliente encontrado. Use “Novo” para cadastrar.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-slate-50" onMouseDown={() => onChange(c)}>
                <span className="block text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-muted">{[c.document && formatDocument(c.document), c.whatsapp].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Novo cliente" description="Cadastro rápido — complete os demais dados depois." size="lg">
        <ClientForm
          compact
          initial={{ name: /\d/.test(q) ? "" : q }}
          onCancel={() => setCreating(false)}
          onSaved={(c) => {
            onChange({ id: c.id, name: c.name });
            setCreating(false);
          }}
        />
      </Modal>
    </div>
  );
}

export function SaleForm({
  initial,
  suppliers,
  sellers,
  canPickSeller,
  showMargin,
}: {
  initial: SaleFormInitial;
  suppliers: { id: string; name: string }[];
  sellers: { id: string; name: string; commissionRateBps: number }[];
  canPickSeller: boolean;
  showMargin: boolean;
}) {
  const router = useRouter();
  const { run, busy } = useAction();
  const editing = !!initial.id;
  const isDraft = !initial.status || initial.status === "ORCAMENTO";
  const [client, setClient] = useState<ClientRef | null>(initial.client);
  const [g, setG] = useState({
    saleDate: initial.saleDate,
    sellerId: initial.sellerId,
    destination: initial.destination,
    tripStart: initial.tripStart,
    tripEnd: initial.tripEnd,
    passengerCount: initial.passengerCount,
    locator: initial.locator,
    notes: initial.notes,
  });
  const [items, setItems] = useState<Item[]>(initial.items.length ? initial.items.map((i) => ({ ...i, uid: newKey() })) : [blankItem()]);
  const [fees, setFees] = useState(initial.feesCents);
  const [discount, setDiscount] = useState(initial.discountCents);
  const [commission, setCommission] = useState(initial.commission);
  const [payments, setPayments] = useState<Payment[]>(initial.payments);
  const [planTouched, setPlanTouched] = useState(editing);
  const [gen, setGen] = useState({ method: "PIX", entryCents: 0, installments: 1, firstDue: initial.saleDate });
  const [passengers, setPassengers] = useState<Passenger[]>(initial.passengers.map((p) => ({ ...p, uid: newKey() })));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const totals = useMemo(
    () =>
      calculateSale(
        items.map((i) => ({ commercialModel: i.commercialModel, priceCents: i.priceCents, costCents: i.commercialModel === "COMISSAO" ? 0 : i.costCents, supplierCommissionCents: i.commercialModel === "COMISSAO" ? i.supplierCommissionCents : 0 })),
        fees,
        discount,
        commission,
      ),
    [items, fees, discount, commission],
  );
  const planTotal = sum(payments.map((p) => p.amountCents));
  const diff = totals.clientPayableCents - planTotal;

  function generate(target = totals.clientPayableCents, cfg = gen) {
    const lockedRows = payments.filter((p) => initial.locked[p.key]);
    const remaining = target - sum(lockedRows.map((p) => p.amountCents));
    if (remaining <= 0) return setPayments(lockedRows);
    const rows: Payment[] = [];
    const entry = Math.min(cfg.entryCents, remaining);
    if (entry > 0) rows.push({ key: newKey(), dueDate: cfg.firstDue, amountCents: entry, method: cfg.method, description: null });
    const rest = remaining - entry;
    const n = Math.max(1, cfg.installments);
    if (rest > 0)
      splitInstallments(rest, n).forEach((amount, i) =>
        rows.push({ key: newKey(), dueDate: addMonths(cfg.firstDue, entry > 0 ? i + 1 : i), amountCents: amount, method: cfg.method, description: null }),
      );
    setPayments([...lockedRows, ...rows]);
  }

  // Enquanto o usuário não editar o plano manualmente, ele acompanha o valor da venda.
  useEffect(() => {
    if (!planTouched) generate(totals.clientPayableCents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.clientPayableCents, planTouched]);

  // Comissão padrão do vendedor (percentual) ao trocar de vendedor numa venda nova.
  useEffect(() => {
    if (editing) return;
    const s = sellers.find((x) => x.id === g.sellerId);
    if (s && s.commissionRateBps > 0 && commission.mode === "PERCENTUAL") setCommission({ mode: "PERCENTUAL", bps: s.commissionRateBps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.sellerId]);

  const updateItem = (uid: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.uid === uid ? { ...i, ...patch } : i)));

  async function submit(confirm: boolean) {
    const payload = {
      saleDate: g.saleDate,
      clientId: client?.id ?? "",
      sellerId: g.sellerId || null,
      destination: g.destination,
      tripStart: g.tripStart || null,
      tripEnd: g.tripEnd || null,
      passengerCount: Number(g.passengerCount) || 1,
      locator: g.locator,
      notes: g.notes,
      feesCents: fees,
      discountCents: discount,
      commission,
      items: items.map(({ uid: _uid, ...i }) => ({
        ...i,
        id: i.id ?? null,
        supplierId: i.supplierId || null,
        supplierDueDate: i.supplierDueDate || null,
        costCents: i.commercialModel === "COMISSAO" ? 0 : i.costCents,
        supplierCommissionCents: i.commercialModel === "COMISSAO" ? i.supplierCommissionCents : 0,
      })),
      payments: payments.map((p) => ({ key: p.key, dueDate: p.dueDate, amountCents: p.amountCents, method: p.method, description: p.description ?? null })),
      passengers: passengers.filter((p) => p.name.trim()).map(({ uid: _u, ...p }) => p),
      confirm,
    };
    if (!client) {
      setErrors({ clientId: "Selecione ou cadastre o cliente." });
      return;
    }
    const r = await run(() => (editing ? updateSaleAction(initial.id!, payload) : createSaleAction(payload)), {
      refresh: false,
      onSuccess: (d) => router.push(`/vendas/${d.id}`),
    });
    if (!r.ok) setErrors(issuesToMap(r.issues));
  }

  const err = (k: string) => errors[k];

  return (
    <div className="grid gap-6 pb-24 xl:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <Section icon={Users} title="Cliente e viagem" description="O essencial para registrar a venda.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4">
              <span className="mb-1.5 block text-xs font-medium text-slate-700">
                Cliente <span className="text-danger">*</span>
              </span>
              <ClientPicker value={client} onChange={setClient} error={err("clientId")} />
            </div>
            <Field label="Destino" error={err("destination")} className="sm:col-span-2">
              <Input value={g.destination} onChange={(e) => setG({ ...g, destination: e.target.value })} placeholder="Ex.: Porto Seguro - BA" />
            </Field>
            <Field label="Data da venda" required error={err("saleDate")}>
              <Input type="date" value={g.saleDate} onChange={(e) => setG({ ...g, saleDate: e.target.value })} />
            </Field>
            {canPickSeller ? (
              <Field label="Vendedor">
                <Select value={g.sellerId} onChange={(e) => setG({ ...g, sellerId: e.target.value })}>
                  {sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Passageiros">
                <Input type="number" min={1} value={g.passengerCount} onChange={(e) => setG({ ...g, passengerCount: Number(e.target.value) })} />
              </Field>
            )}
            <Field label="Início da viagem" error={err("tripStart")}>
              <Input type="date" value={g.tripStart} onChange={(e) => setG({ ...g, tripStart: e.target.value })} />
            </Field>
            <Field label="Retorno" error={err("tripEnd")}>
              <Input type="date" value={g.tripEnd} min={g.tripStart || undefined} onChange={(e) => setG({ ...g, tripEnd: e.target.value })} />
            </Field>
            {canPickSeller && (
              <Field label="Passageiros">
                <Input type="number" min={1} value={g.passengerCount} onChange={(e) => setG({ ...g, passengerCount: Number(e.target.value) })} />
              </Field>
            )}
            <Field label="Localizador / nº da reserva">
              <Input value={g.locator} onChange={(e) => setG({ ...g, locator: e.target.value })} />
            </Field>
          </div>
        </Section>

        <Section
          icon={Package}
          title="Produtos e serviços"
          description="Inclua quantos itens precisar; cada um pode ter seu fornecedor."
          aside={
            <Button type="button" variant="secondary" size="sm" onClick={() => setItems([...items, blankItem()])}>
              <Plus className="h-4 w-4" /> Adicionar produto
            </Button>
          }
        >
          {err("items") && <p className="mb-3 text-sm text-danger">{err("items")}</p>}
          <div className="space-y-4">
            {items.map((i, idx) => (
              <div key={i.uid} className="rounded-xl border border-line p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Badge tone="blue">Produto {idx + 1}</Badge>
                  {items.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setItems(items.filter((x) => x.uid !== i.uid))} aria-label="Remover produto">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Tipo">
                    <Select value={i.productType} onChange={(e) => updateItem(i.uid, { productType: e.target.value })}>
                      {PRODUCT_TYPES.values.map((v) => (
                        <option key={v} value={v}>
                          {PRODUCT_TYPES.label(v)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Descrição" className="lg:col-span-2">
                    <Input value={i.description} onChange={(e) => updateItem(i.uid, { description: e.target.value })} placeholder="Ex.: Pacote 7 noites com aéreo" />
                  </Field>
                  <Field label="Fornecedor">
                    <Select value={i.supplierId} onChange={(e) => updateItem(i.uid, { supplierId: e.target.value })}>
                      <option value="">Selecione…</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Modelo comercial" className="sm:col-span-2" hint={COMMERCIAL_MODEL_HELP[i.commercialModel]}>
                    <Select value={i.commercialModel} onChange={(e) => updateItem(i.uid, { commercialModel: e.target.value as CommercialModel })}>
                      {COMMERCIAL_MODELS.values.map((v) => (
                        <option key={v} value={v}>
                          {COMMERCIAL_MODELS.label(v)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Valor vendido" required error={err(`items.${idx}.priceCents`)}>
                    <MoneyInput value={i.priceCents} onChange={(v) => updateItem(i.uid, { priceCents: v })} />
                  </Field>
                  {i.commercialModel === "COMISSAO" ? (
                    <Field label="Comissão do fornecedor" error={err(`items.${idx}.supplierCommissionCents`)}>
                      <MoneyInput value={i.supplierCommissionCents} onChange={(v) => updateItem(i.uid, { supplierCommissionCents: v })} />
                    </Field>
                  ) : (
                    <Field label="Custo / repasse" error={err(`items.${idx}.costCents`)}>
                      <MoneyInput value={i.costCents} onChange={(v) => updateItem(i.uid, { costCents: v })} />
                    </Field>
                  )}
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-brand-600">Vencimento do fornecedor e localizador do item</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label={i.commercialModel === "COMISSAO" ? "Previsão de recebimento da comissão" : "Vencimento do pagamento ao fornecedor"} hint="Se vazio, o sistema sugere uma data com base na viagem.">
                      <Input type="date" value={i.supplierDueDate} onChange={(e) => updateItem(i.uid, { supplierDueDate: e.target.value })} />
                    </Field>
                    <Field label="Localizador do item">
                      <Input value={i.locator} onChange={(e) => updateItem(i.uid, { locator: e.target.value })} />
                    </Field>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={Wallet} title="Valores da venda" description="Taxas, descontos e comissão do vendedor.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Taxas adicionais" hint="Ex.: taxa de serviço da agência">
              <MoneyInput value={fees} onChange={setFees} />
            </Field>
            <Field label="Desconto concedido" error={err("discountCents")}>
              <MoneyInput value={discount} onChange={setDiscount} />
            </Field>
            <Field label="Comissão do vendedor">
              <Select
                value={commission.mode}
                onChange={(e) => {
                  const s = sellers.find((x) => x.id === g.sellerId);
                  setCommission(e.target.value === "VALOR" ? { mode: "VALOR", amountCents: totals.sellerCommissionCents } : { mode: "PERCENTUAL", bps: s?.commissionRateBps ?? 1000 });
                }}
              >
                <option value="VALOR">Valor fixo (R$)</option>
                <option value="PERCENTUAL">% sobre a margem</option>
              </Select>
            </Field>
            {commission.mode === "VALOR" ? (
              <Field label="Valor da comissão">
                <MoneyInput value={commission.amountCents} onChange={(v) => setCommission({ mode: "VALOR", amountCents: v })} />
              </Field>
            ) : (
              <Field label="Percentual" hint={`= ${formatBRL(totals.sellerCommissionCents)}`}>
                <div className="relative">
                  <Input type="number" min={0} max={100} step={0.5} value={commission.bps / 100} onChange={(e) => setCommission({ mode: "PERCENTUAL", bps: Math.round(Number(e.target.value) * 100) })} className="pr-8 text-right" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                </div>
              </Field>
            )}
          </div>
        </Section>

        <Section icon={CreditCard} title="Forma de pagamento do cliente" description={`Valor a receber do cliente: ${formatBRL(totals.clientPayableCents)}`}>
          {totals.clientPayableCents === 0 ? (
            <p className="text-sm text-muted">Nenhum valor a receber do cliente (itens pagos diretamente ao fornecedor).</p>
          ) : (
            <>
              <div className="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Forma">
                  <Select value={gen.method} onChange={(e) => setGen({ ...gen, method: e.target.value })}>
                    {PAYMENT_METHODS.values.map((v) => (
                      <option key={v} value={v}>
                        {PAYMENT_METHODS.label(v)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Entrada (opcional)">
                  <MoneyInput value={gen.entryCents} onChange={(v) => setGen({ ...gen, entryCents: v })} />
                </Field>
                <Field label="Parcelas">
                  <Select value={gen.installments} onChange={(e) => setGen({ ...gen, installments: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n === 1 ? "À vista" : `${n}x`}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="1º vencimento">
                  <Input type="date" value={gen.firstDue} onChange={(e) => setGen({ ...gen, firstDue: e.target.value })} />
                </Field>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => {
                      setPlanTouched(true);
                      generate();
                    }}
                  >
                    <Wand2 className="h-4 w-4" /> Gerar parcelas
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="pb-2 font-medium">#</th>
                      <th className="pb-2 font-medium">Vencimento</th>
                      <th className="pb-2 font-medium">Forma</th>
                      <th className="pb-2 text-right font-medium">Valor</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, idx) => {
                      const lockedCents = initial.locked[p.key];
                      return (
                        <tr key={p.key} className="border-t border-line">
                          <td className="py-2 pr-2 text-xs text-muted">{idx + 1}</td>
                          <td className="py-2 pr-2">
                            <Input
                              type="date"
                              value={p.dueDate}
                              onChange={(e) => {
                                setPlanTouched(true);
                                setPayments(payments.map((x) => (x.key === p.key ? { ...x, dueDate: e.target.value } : x)));
                              }}
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <Select
                              value={p.method}
                              onChange={(e) => {
                                setPlanTouched(true);
                                setPayments(payments.map((x) => (x.key === p.key ? { ...x, method: e.target.value } : x)));
                              }}
                            >
                              {PAYMENT_METHODS.values.map((v) => (
                                <option key={v} value={v}>
                                  {PAYMENT_METHODS.label(v)}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="w-44 py-2 pr-2">
                            <MoneyInput
                              value={p.amountCents}
                              onChange={(v) => {
                                setPlanTouched(true);
                                setPayments(payments.map((x) => (x.key === p.key ? { ...x, amountCents: v } : x)));
                              }}
                            />
                            {lockedCents && <p className="mt-0.5 text-[11px] text-muted">Já recebido: {formatBRL(lockedCents)}</p>}
                          </td>
                          <td className="py-2 text-right">
                            {lockedCents ? (
                              <span title="Parcela com recebimento registrado: não pode ser removida." className="inline-flex p-2 text-slate-400">
                                <Lock className="h-4 w-4" />
                              </span>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Remover parcela"
                                onClick={() => {
                                  setPlanTouched(true);
                                  setPayments(payments.filter((x) => x.key !== p.key));
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPlanTouched(true);
                    const last = payments[payments.length - 1];
                    setPayments([...payments, { key: newKey(), dueDate: last ? addMonths(last.dueDate, 1) : g.saleDate, amountCents: Math.max(diff, 0), method: last?.method ?? "PIX" }]);
                  }}
                >
                  <Plus className="h-4 w-4" /> Adicionar pagamento
                </Button>
                {diff === 0 ? (
                  <span className="inline-flex items-center gap-1 text-sm text-success">
                    <CheckCircle2 className="h-4 w-4" /> Parcelas conferem com o valor da venda
                  </span>
                ) : (
                  <span className="text-sm font-medium text-danger">
                    {diff > 0 ? `Faltam ${formatBRL(diff)}` : `Excedente de ${formatBRL(-diff)}`} nas parcelas
                  </span>
                )}
              </div>
              {err("payments") && <p className="mt-2 text-sm text-danger">{err("payments")}</p>}
            </>
          )}
        </Section>

        <details className="group rounded-xl border border-line bg-white">
          <summary className="flex cursor-pointer items-center justify-between px-5 py-3.5 text-sm font-semibold">
            Passageiros e observações <span className="text-xs font-normal text-muted">opcional — pode ser preenchido depois</span>
          </summary>
          <div className="space-y-4 border-t border-line p-5">
            {passengers.map((p) => (
              <div key={p.uid} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-6">
                <Field label="Nome" className="sm:col-span-2">
                  <Input value={p.name} onChange={(e) => setPassengers(passengers.map((x) => (x.uid === p.uid ? { ...x, name: e.target.value } : x)))} />
                </Field>
                <Field label="CPF / RG">
                  <Input value={p.document} onChange={(e) => setPassengers(passengers.map((x) => (x.uid === p.uid ? { ...x, document: e.target.value } : x)))} />
                </Field>
                <Field label="Nascimento">
                  <Input type="date" value={p.birthDate} onChange={(e) => setPassengers(passengers.map((x) => (x.uid === p.uid ? { ...x, birthDate: e.target.value } : x)))} />
                </Field>
                <Field label="Passaporte (se necessário)">
                  <Input value={p.passportNumber} onChange={(e) => setPassengers(passengers.map((x) => (x.uid === p.uid ? { ...x, passportNumber: e.target.value } : x)))} autoComplete="off" />
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPassengers(passengers.filter((x) => x.uid !== p.uid))}>
                    <Trash2 className="h-4 w-4" /> Remover
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={() => setPassengers([...passengers, { uid: newKey(), name: "", document: "", birthDate: "", passportNumber: "", passportExpiry: "" }])}>
              <Plus className="h-4 w-4" /> Adicionar passageiro
            </Button>
            <p className="flex items-center gap-1 text-xs text-muted">
              <Info className="h-3.5 w-3.5" /> Documentos como passaporte são opcionais e exibidos mascarados. Colete apenas quando o produto exigir.
            </p>
            <Field label="Observações da venda">
              <Textarea value={g.notes} onChange={(e) => setG({ ...g, notes: e.target.value })} />
            </Field>
          </div>
        </details>
      </div>

      <aside className="xl:sticky xl:top-20 xl:self-start">
        <Card className="p-5">
          <h3 className="text-sm font-semibold">Resumo da venda</h3>
          <dl className="mt-4 space-y-2.5 text-sm">
            <Row label="Faturamento (total vendido)" value={formatBRL(totals.grossCents)} strong />
            <Row label="A receber do cliente" value={formatBRL(totals.clientPayableCents)} />
            <Row label="Custos / repasses a fornecedores" value={formatBRL(totals.costCents)} />
            {showMargin && <Row label="Receita da agência" value={formatBRL(totals.agencyRevenueCents)} />}
            <Row label="Comissão do vendedor" value={formatBRL(totals.sellerCommissionCents)} />
            {showMargin && (
              <>
                <div className="my-2 border-t border-dashed border-line" />
                <Row label="Lucro bruto" value={formatBRL(totals.grossProfitCents)} strong tone={totals.grossProfitCents < 0 ? "danger" : "success"} />
                <Row label="Margem" value={formatPercentBps(totals.marginBps)} />
              </>
            )}
          </dl>
          <div className="mt-5 rounded-lg bg-brand-50 p-3 text-xs text-brand-900">
            Ao confirmar, o sistema cria automaticamente: {payments.length} parcela(s) a receber, contas a pagar aos fornecedores, a comissão do vendedor, as reservas e a prévia do contrato.
          </div>
        </Card>
      </aside>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
          <span className="mr-auto hidden text-sm text-muted sm:block">
            Total <strong className="tabular text-ink">{formatBRL(totals.grossCents)}</strong>
            {editing && initial.code && <> · {initial.code}</>}
          </span>
          <Button variant="outline" type="button" onClick={() => router.back()}>
            Cancelar
          </Button>
          {isDraft && (
            <Button variant="secondary" type="button" loading={busy} onClick={() => submit(false)}>
              Salvar rascunho
            </Button>
          )}
          <Button type="button" loading={busy} onClick={() => submit(true)}>
            <CheckCircle2 className="h-4 w-4" /> {isDraft ? "Confirmar venda" : "Salvar alterações"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "danger" | "success" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("tabular", strong && "font-semibold text-ink", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{value}</dd>
    </div>
  );
}
