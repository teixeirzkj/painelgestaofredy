"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Undo2, Paperclip, Upload, Pencil, Ban, ExternalLink } from "lucide-react";
import { Badge, Button, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { ConfirmDialog, Drawer, Modal, MoneyInput } from "@/components/ui/client";
import { EntryStatusBadge } from "@/components/status";
import { useAction, issuesToMap } from "@/components/use-action";
import {
  cancelEntryAction,
  createPayableAction,
  createReceivableAction,
  getEntryAction,
  reverseSettlementAction,
  settleEntryAction,
  updateEntryAction,
} from "@/app/actions";
import { formatBRL, settlementPrincipalSafe } from "./helpers";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAYABLE_CATEGORIES, PAYMENT_METHODS, RECEIVABLE_CATEGORIES } from "@/lib/constants";
import { todayIn } from "@/lib/dates";

type Kind = "receivable" | "payable";
type Entry = Extract<Awaited<ReturnType<typeof getEntryAction>>, { ok: true }>["data"];

let companyToday = "";
function today() {
  return companyToday || todayIn("America/Sao_Paulo");
}

type Opt = { id: string; name: string };
type EntryExtra = { costCenter?: Opt | null; invoice?: { id: string; number: string; status: string } | null };

type CatOpt = { value: string; label: string; group: string };

/** Opções de categoria: despesas vêm do cadastro editável da agência (agrupadas); receitas são fixas. */
function CategoryOptions({ kind, expense }: { kind: Kind; expense: CatOpt[] }) {
  if (kind === "receivable")
    return (
      <>
        {RECEIVABLE_CATEGORIES.values.map((v) => (
          <option key={v} value={v}>
            {RECEIVABLE_CATEGORIES.label(v)}
          </option>
        ))}
      </>
    );
  const groups = [...new Set(expense.map((c) => c.group))];
  if (!expense.length)
    return (
      <>
        {PAYABLE_CATEGORIES.values.map((v) => (
          <option key={v} value={v}>
            {PAYABLE_CATEGORIES.label(v)}
          </option>
        ))}
      </>
    );
  return (
    <>
      {groups.map((g) => (
        <optgroup key={g} label={g}>
          {expense
            .filter((c) => c.group === g)
            .map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}

export function EntryDrawerHost({ kind, openId, accounts, canManage, todayStr, costCenters = [], expenseCategories = [] }: { kind: Kind; openId?: string; accounts: Opt[]; canManage: boolean; todayStr: string; costCenters?: Opt[]; expenseCategories?: CatOpt[] }) {
  companyToday = todayStr;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"view" | "settle" | "edit">("view");

  const load = useCallback(async () => {
    if (!openId) return;
    setLoading(true);
    const r = await getEntryAction(kind, openId);
    setLoading(false);
    if (r.ok) setEntry(r.data);
    else toast.error(r.error);
  }, [kind, openId]);

  useEffect(() => {
    setEntry(null);
    setMode("view");
    load();
  }, [load]);

  const close = () => {
    const p = new URLSearchParams(sp.toString());
    p.delete("abrir");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };

  if (!openId) return null;
  const isRec = kind === "receivable";
  const invoice = (entry as (Entry & EntryExtra) | null)?.invoice ?? null;
  const open = entry && entry.status !== "CANCELADO" && entry.balanceCents > 0 && !invoice;

  return (
    <Drawer
      open
      onClose={close}
      title={entry?.description ?? "Carregando…"}
      description={entry ? <span className="flex items-center gap-2"><EntryStatusBadge kind={kind} s={entry.displayStatus} /> vence em {formatDate(entry.dueDate)}</span> : undefined}
      footer={
        entry && canManage && mode === "view" ? (
          <>
            {entry.status !== "CANCELADO" && (
              <Button variant="outline" onClick={() => setMode("edit")}>
                <Pencil className="h-4 w-4" /> Editar
              </Button>
            )}
            {open && (
              <Button onClick={() => setMode("settle")}>
                <Plus className="h-4 w-4" /> {isRec ? "Registrar recebimento" : "Registrar pagamento"}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {loading || !entry ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-32" />
        </div>
      ) : mode === "settle" ? (
        <SettleForm kind={kind} entry={entry} accounts={accounts} onDone={() => (setMode("view"), load())} onCancel={() => setMode("view")} />
      ) : mode === "edit" ? (
        <EditForm kind={kind} entry={entry} costCenters={costCenters} expenseCategories={expenseCategories} onDone={() => (setMode("view"), load())} onCancel={() => setMode("view")} />
      ) : (
        <EntryDetails kind={kind} entry={entry} canManage={canManage} reload={load} onClosed={close} />
      )}
    </Drawer>
  );
}

function EntryDetails({ kind, entry, canManage, reload, onClosed }: { kind: Kind; entry: Entry; canManage: boolean; reload: () => void; onClosed: () => void }) {
  const { run } = useAction();
  const [reverse, setReverse] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isRec = kind === "receivable";
  const moved = "receivedCents" in entry ? (entry as { receivedCents: number }).receivedCents : (entry as { paidCents: number }).paidCents;
  const party = ("client" in entry && (entry as { client: { id: string; name: string } | null }).client) || null;

  async function upload(file: File) {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    fd.set("id", entry.id);
    setUploading(true);
    try {
      const res = await fetch("/api/anexos", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) toast.error(j.error ?? "Falha no envio.");
      else {
        toast.success("Comprovante anexado.");
        reload();
      }
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6 text-sm">
      <div className="grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-4">
        <div>
          <p className="text-xs text-muted">Valor original</p>
          <p className="font-semibold tabular">{formatBRL(entry.amountCents)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">{isRec ? "Recebido" : "Pago"}</p>
          <p className="font-semibold tabular text-success">{formatBRL(moved)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Saldo</p>
          <p className="font-semibold tabular">{formatBRL(entry.status === "CANCELADO" ? 0 : entry.balanceCents)}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Info label="Categoria" value={(isRec ? RECEIVABLE_CATEGORIES : PAYABLE_CATEGORIES).label(entry.category)} />
        <Info label="Forma prevista" value={PAYMENT_METHODS.label(entry.method)} />
        {party && <Info label="Cliente" value={<Link className="text-brand-700 hover:underline" href={`/clientes/${party.id}`}>{party.name}</Link>} />}
        {entry.supplier && <Info label="Fornecedor" value={<Link className="text-brand-700 hover:underline" href={`/fornecedores/${entry.supplier.id}`}>{entry.supplier.name}</Link>} />}
        {entry.sale && (
          <Info
            label="Venda vinculada"
            value={
              <Link className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" href={`/vendas/${entry.sale.id}`}>
                {entry.sale.code} <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
        )}
        {entry.installmentNumber && <Info label="Parcela" value={`${entry.installmentNumber} de ${entry.installmentCount}`} />}
        {(entry as Entry & EntryExtra).costCenter && <Info label="Centro de custo" value={(entry as Entry & EntryExtra).costCenter!.name} />}
        {(entry as Entry & EntryExtra).invoice && (
          <Info
            label="Fatura do fornecedor"
            value={
              <Link className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" href={`/financeiro/faturas/${(entry as Entry & EntryExtra).invoice!.id}`}>
                {(entry as Entry & EntryExtra).invoice!.number} <ExternalLink className="h-3 w-3" />
              </Link>
            }
          />
        )}
        <Info label="Origem" value={entry.sourceKey ? <Badge tone="blue">{entry.sourceKey.startsWith("ajuste:") ? "Ajuste da venda" : "Gerado automaticamente"}</Badge> : <Badge>Lançamento manual</Badge>} />
      </dl>
      {entry.notes && <p className="whitespace-pre-wrap rounded-lg border border-line p-3 text-slate-700">{entry.notes}</p>}
      {(entry as Entry & EntryExtra).invoice && entry.status !== "PAGO" && (
        <p className="rounded-lg bg-brand-25 p-3 text-xs text-brand-900">Este lançamento está consolidado em uma fatura do fornecedor: o pagamento é registrado pela fatura, evitando pagamento em duplicidade.</p>
      )}

      <section>
        <h3 className="mb-2 font-semibold">Histórico de {isRec ? "recebimentos" : "pagamentos"}</h3>
        {entry.settlements.length === 0 ? (
          <p className="text-muted">Nenhuma baixa registrada.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {entry.settlements.map((s) => (
              <li key={s.id} className={`flex items-start justify-between gap-3 p-3 ${s.reversedAt ? "bg-slate-50 text-muted" : ""}`}>
                <div>
                  <p className={`font-medium tabular ${s.reversedAt ? "line-through" : ""}`}>{formatBRL(s.amountCents)}</p>
                  <p className="text-xs text-muted">
                    {formatDate(s.date)} · {s.account.name}
                    {s.method && ` · ${PAYMENT_METHODS.label(s.method)}`}
                    {s.interestCents > 0 && ` · juros ${formatBRL(s.interestCents)}`}
                    {s.discountCents > 0 && ` · desconto ${formatBRL(s.discountCents)}`}
                  </p>
                  {s.reversedAt && <p className="text-xs text-danger">Estornado em {formatDateTime(s.reversedAt)} — {s.reversalReason}</p>}
                  {s.notes && <p className="text-xs">{s.notes}</p>}
                </div>
                {canManage && !s.reversedAt && (
                  <Button variant="ghost" size="sm" onClick={() => setReverse(s.id)}>
                    <Undo2 className="h-4 w-4" /> Estornar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-semibold">Comprovantes</h3>
          {canManage && (
            <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
              <Upload className="h-3.5 w-3.5" /> {uploading ? "Enviando…" : "Anexar (PDF/imagem, até 5 MB)"}
              <input type="file" className="hidden" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          )}
        </div>
        {entry.attachments.length === 0 ? (
          <p className="text-muted">Nenhum comprovante anexado.</p>
        ) : (
          <ul className="space-y-1">
            {entry.attachments.map((a) => (
              <li key={a.id}>
                <a href={`/api/anexos/${a.id}`} target="_blank" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                  <Paperclip className="h-3.5 w-3.5" /> {a.fileName}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && entry.status !== "CANCELADO" && (!entry.sourceKey || entry.sourceKey.startsWith("ajuste:")) && entry.settledCents === 0 && !(entry as Entry & EntryExtra).invoice && (
        <Button variant="ghost" className="text-danger" onClick={() => setCancel(true)}>
          <Ban className="h-4 w-4" /> Cancelar lançamento
        </Button>
      )}
      {entry.sourceKey && !entry.sourceKey.startsWith("ajuste:") && <p className="text-xs text-muted">Valor controlado pela venda vinculada: para alterá-lo ou cancelá-lo, edite a venda.</p>}

      <ConfirmDialog
        open={!!reverse}
        onClose={() => setReverse(null)}
        title="Estornar baixa?"
        description="O valor volta a ficar em aberto. O registro original é mantido no histórico, marcado como estornado."
        confirmLabel="Estornar"
        reason={{ label: "Motivo do estorno", required: true }}
        onConfirm={async (reason) => {
          await run(() => reverseSettlementAction(reverse!, reason), { onSuccess: () => (setReverse(null), reload()) });
        }}
      />
      <ConfirmDialog
        open={cancel}
        onClose={() => setCancel(false)}
        title="Cancelar lançamento?"
        description="O lançamento deixará de compor saldos, fluxo de caixa e relatórios. Ele continuará visível com o status Cancelado."
        confirmLabel="Cancelar lançamento"
        onConfirm={async () => {
          await run(() => cancelEntryAction(kind, entry.id), { onSuccess: () => (setCancel(false), onClosed()) });
        }}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function SettleForm({ kind, entry, accounts: allAccounts, onDone, onCancel }: { kind: Kind; entry: Entry; accounts: { id: string; name: string; type?: string }[]; onDone: () => void; onCancel: () => void }) {
  // cartão de crédito da agência só paga contas (fornecedor que só aceita cartão)
  const accounts = kind === "receivable" ? allAccounts.filter((a) => a.type !== "CARTAO_CREDITO") : allAccounts;
  const [d, setD] = useState({ date: today(), amountCents: entry.balanceCents, interestCents: 0, discountCents: 0, accountId: accounts[0]?.id ?? "", method: entry.method ?? "PIX", notes: "", cardInstallments: 1 });
  const isCard = accounts.find((a) => a.id === d.accountId)?.type === "CARTAO_CREDITO";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const principal = settlementPrincipalSafe(d.amountCents, d.interestCents, d.discountCents);
  const remaining = entry.balanceCents - principal;
  const isRec = kind === "receivable";

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => settleEntryAction(kind, entry.id, d), { onSuccess: onDone });
        if (!r.ok) setErrors(issuesToMap(r.issues));
      }}
    >
      <p className="rounded-lg bg-slate-50 p-3 text-sm">
        Saldo em aberto: <strong className="tabular">{formatBRL(entry.balanceCents)}</strong>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={isRec ? "Valor recebido" : "Valor pago"} required error={errors.amountCents}>
          <MoneyInput value={d.amountCents} onChange={(v) => setD({ ...d, amountCents: v })} autoFocus />
        </Field>
        <Field label="Data" required error={errors.date}>
          <Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
        </Field>
        <Field label="Juros / multa" hint="Incluídos no valor movimentado">
          <MoneyInput value={d.interestCents} onChange={(v) => setD({ ...d, interestCents: v })} />
        </Field>
        <Field label="Desconto concedido" hint="Abate o saldo sem entrar no caixa">
          <MoneyInput value={d.discountCents} onChange={(v) => setD({ ...d, discountCents: v })} />
        </Field>
        <Field label="Conta financeira" required error={errors.accountId}>
          <Select value={d.accountId} onChange={(e) => setD({ ...d, accountId: e.target.value })}>
            {accounts.length === 0 && <option value="">Cadastre uma conta em Contas e transferências</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.type === "CARTAO_CREDITO" ? " (cartão da agência)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {isCard ? (
          <Field label="Parcelas no cartão" hint="Cada parcela entra na fatura do mês">
            <Select value={d.cardInstallments} onChange={(e) => setD({ ...d, cardInstallments: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "À vista" : n + "x"}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Forma">
            <Select value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })}>
              {PAYMENT_METHODS.values.map((v) => (
                <option key={v} value={v}>
                  {PAYMENT_METHODS.label(v)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {isCard && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Pago com o cartão da agência: esta conta fica quitada e o valor vai para a <strong>fatura do cartão</strong>, que aparece em Contas a pagar no vencimento do cartão.
        </p>
      )}
      <Field label="Observações">
        <Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </Field>
      <div className={`rounded-lg p-3 text-sm ${remaining < 0 ? "bg-red-50 text-danger" : "bg-brand-50 text-brand-900"}`}>
        Abate {formatBRL(principal)} do saldo.{" "}
        {remaining > 0 ? `Restará ${formatBRL(remaining)} em aberto (baixa parcial).` : remaining === 0 ? "O lançamento ficará quitado." : "Valor acima do saldo em aberto."}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Voltar
        </Button>
        <Button type="submit" loading={busy} disabled={remaining < 0 || !d.accountId}>
          Confirmar baixa
        </Button>
      </div>
    </form>
  );
}

function EditForm({ kind, entry, costCenters, expenseCategories, onDone, onCancel }: { kind: Kind; entry: Entry; costCenters: Opt[]; expenseCategories: CatOpt[]; onDone: () => void; onCancel: () => void }) {
  const extra = entry as Entry & EntryExtra;
  const [d, setD] = useState({ description: entry.description, amountCents: entry.amountCents, dueDate: entry.dueDate, category: entry.category, method: entry.method ?? "", notes: entry.notes ?? "", costCenterId: extra.costCenter?.id ?? "" });
  const { run, busy } = useAction();
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => updateEntryAction(kind, entry.id, { ...d, method: d.method || null, costCenterId: d.costCenterId || null }), { onSuccess: onDone });
      }}
    >
      <Field label="Descrição" required>
        <Input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Valor" hint={entry.sourceKey ? "Definido pela venda" : undefined}>
          <MoneyInput value={d.amountCents} onChange={(v) => setD({ ...d, amountCents: v })} disabled={!!entry.sourceKey} />
        </Field>
        <Field label="Vencimento" hint={extra.invoice ? "Definido pela fatura" : undefined}>
          <Input type="date" value={d.dueDate} disabled={!!extra.invoice} onChange={(e) => setD({ ...d, dueDate: e.target.value })} />
        </Field>
        <Field label="Categoria">
          <Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
            <CategoryOptions kind={kind} expense={expenseCategories} />
          </Select>
        </Field>
        <Field label="Forma prevista">
          <Select value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })}>
            <option value="">—</option>
            {PAYMENT_METHODS.values.map((v) => (
              <option key={v} value={v}>
                {PAYMENT_METHODS.label(v)}
              </option>
            ))}
          </Select>
        </Field>
        {costCenters.length > 0 && (
          <Field label="Centro de custo">
            <Select value={d.costCenterId} onChange={(e) => setD({ ...d, costCenterId: e.target.value })}>
              <option value="">—</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Observações">
        <Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Voltar
        </Button>
        <Button type="submit" loading={busy}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

export function NewEntryButton({ kind, options, todayStr }: { kind: Kind; todayStr: string; options: { clients: Opt[]; suppliers: Opt[]; costCenters?: Opt[]; expenseCategories?: CatOpt[] } }) {
  companyToday = todayStr;
  const [open, setOpen] = useState(false);
  const isRec = kind === "receivable";
  const init = { description: "", partyId: "", category: isRec ? "OUTRAS_RECEITAS" : "ADMINISTRATIVAS", amountCents: 0, firstDueDate: today(), installments: 1, recurringMonths: 1, method: "", notes: "", costCenterId: "", mode: "unico" as "unico" | "parcelado" | "recorrente" };
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();

  const submit = async () => {
    const payload = {
      description: d.description,
      category: d.category,
      amountCents: d.amountCents,
      firstDueDate: d.firstDueDate,
      installments: d.mode === "parcelado" ? d.installments : 1,
      method: d.method || null,
      notes: d.notes,
      costCenterId: d.costCenterId || null,
      ...(isRec ? { clientId: d.partyId || null } : { supplierId: d.partyId || null, recurringMonths: d.mode === "recorrente" ? d.recurringMonths : 1 }),
    };
    const r = await run(() => (isRec ? createReceivableAction(payload) : createPayableAction(payload)), { onSuccess: () => (setOpen(false), setD(init)) });
    if (!r.ok) setErrors(issuesToMap(r.issues));
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> {isRec ? "Nova conta a receber" : "Nova despesa"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isRec ? "Nova conta a receber" : "Nova conta a pagar"}
        description={isRec ? "Recebimentos de vendas são gerados automaticamente. Use para outras receitas." : "Despesas operacionais, fornecedores, salários, impostos…"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button loading={busy} onClick={submit}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Descrição" required error={errors.description} className="sm:col-span-2">
            <Input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} autoFocus />
          </Field>
          <Field label="Categoria" required>
            <Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
              <CategoryOptions kind={kind} expense={options.expenseCategories ?? []} />
            </Select>
          </Field>
          <Field label={isRec ? "Cliente (opcional)" : "Fornecedor (opcional)"}>
            <Select value={d.partyId} onChange={(e) => setD({ ...d, partyId: e.target.value })}>
              <option value="">—</option>
              {(isRec ? options.clients : options.suppliers).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={d.mode === "recorrente" ? "Valor mensal" : "Valor total"} required error={errors.amountCents}>
            <MoneyInput value={d.amountCents} onChange={(v) => setD({ ...d, amountCents: v })} />
          </Field>
          <Field label={d.mode === "unico" ? "Vencimento" : "1º vencimento"} required error={errors.firstDueDate}>
            <Input type="date" value={d.firstDueDate} onChange={(e) => setD({ ...d, firstDueDate: e.target.value })} />
          </Field>
          <Field label="Condição">
            <Select value={d.mode} onChange={(e) => setD({ ...d, mode: e.target.value as typeof d.mode })}>
              <option value="unico">Pagamento único</option>
              <option value="parcelado">Parcelado</option>
              {!isRec && <option value="recorrente">Recorrente (mensal)</option>}
            </Select>
          </Field>
          {d.mode === "parcelado" && (
            <Field label="Número de parcelas" hint={d.amountCents ? `≈ ${formatBRL(Math.floor(d.amountCents / d.installments))} cada` : undefined}>
              <Input type="number" min={2} max={48} value={d.installments} onChange={(e) => setD({ ...d, installments: Number(e.target.value) })} />
            </Field>
          )}
          {d.mode === "recorrente" && (
            <Field label="Repetir por (meses)">
              <Input type="number" min={2} max={36} value={d.recurringMonths} onChange={(e) => setD({ ...d, recurringMonths: Number(e.target.value) })} />
            </Field>
          )}
          <Field label="Forma prevista">
            <Select value={d.method} onChange={(e) => setD({ ...d, method: e.target.value })}>
              <option value="">—</option>
              {PAYMENT_METHODS.values.map((v) => (
                <option key={v} value={v}>
                  {PAYMENT_METHODS.label(v)}
                </option>
              ))}
            </Select>
          </Field>
          {(options.costCenters?.length ?? 0) > 0 && (
            <Field label="Centro de custo">
              <Select value={d.costCenterId} onChange={(e) => setD({ ...d, costCenterId: e.target.value })}>
                <option value="">—</option>
                {options.costCenters!.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Observações" className="sm:col-span-2">
            <Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
