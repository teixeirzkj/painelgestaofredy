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
  linkPayableToCardAction,
  reverseSettlementAction,
  settleEntryAction,
  updateEntryAction,
} from "@/app/actions";
import { formatBRL, settlementPrincipalSafe } from "./helpers";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PAYABLE_CATEGORIES, PAYMENT_METHODS, RECEIVABLE_CATEGORIES } from "@/lib/constants";
import { todayIn } from "@/lib/dates";
import { addBillMonths, billMonthForDueDate, billMonthLabel, billMonthOf, cardPlan, oldPurchaseFirstBillMonth } from "@/lib/card-bills";

type Kind = "receivable" | "payable";
type Entry = Extract<Awaited<ReturnType<typeof getEntryAction>>, { ok: true }>["data"];

let companyToday = "";
function today() {
  return companyToday || todayIn("America/Sao_Paulo");
}

type Opt = { id: string; name: string };
type EntryExtra = { costCenter?: Opt | null; invoice?: { id: string; number: string; status: string } | null };

type CatOpt = { value: string; label: string; group: string };
/** Conta financeira; cartão da agência traz os dias de fechamento e vencimento (para a prévia das faturas). */
type AccountOpt = { id: string; name: string; type?: string; closingDay?: number | null; dueDay?: number | null };

/** Categoria preenchida pelo sistema na fatura do cartão: nunca escolhida à mão. */
const CARD_BILL_CATEGORY = "FATURA_CARTAO";

/** Opções de categoria: despesas vêm do cadastro editável da agência (agrupadas); receitas são fixas. */
function CategoryOptions({ kind, expense: all }: { kind: Kind; expense: CatOpt[] }) {
  const expense = all.filter((c) => c.value !== CARD_BILL_CATEGORY);
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
        {PAYABLE_CATEGORIES.values.filter((v) => v !== CARD_BILL_CATEGORY).map((v) => (
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

export function EntryDrawerHost({ kind, openId, accounts, canManage, todayStr, costCenters = [], expenseCategories = [] }: { kind: Kind; openId?: string; accounts: AccountOpt[]; canManage: boolean; todayStr: string; costCenters?: Opt[]; expenseCategories?: CatOpt[] }) {
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
                <Plus className="h-4 w-4" /> {isRec ? "Registrar recebimento (total ou parcial)" : "Registrar pagamento (total ou parcial)"}
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
        <EntryDetails kind={kind} entry={entry} canManage={canManage} reload={load} onClosed={close} accounts={accounts} expenseCategories={expenseCategories} />
      )}
    </Drawer>
  );
}

function EntryDetails({
  kind,
  entry,
  canManage,
  reload,
  onClosed,
  accounts,
  expenseCategories,
}: {
  kind: Kind;
  entry: Entry;
  canManage: boolean;
  reload: () => void;
  onClosed: () => void;
  accounts: AccountOpt[];
  expenseCategories: CatOpt[];
}) {
  const { run } = useAction();
  const [reverse, setReverse] = useState<string | null>(null);
  const [cancel, setCancel] = useState(false);
  const [linking, setLinking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isRec = kind === "receivable";
  const isCardBill = !isRec && entry.origin === "CARTAO";
  // lançamento antigo feito à mão com a categoria da fatura: não está ligado a nenhum cartão
  const looseCardBill = !isRec && !isCardBill && entry.category === CARD_BILL_CATEGORY && !entry.sourceKey;
  const canLink = looseCardBill && canManage && entry.status !== "CANCELADO" && entry.settledCents === 0 && !(entry as Entry & EntryExtra).invoice;
  const purchases = isCardBill ? (entry.notes ?? "").split("\n").filter(Boolean) : [];
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
        {entry.status !== "CANCELADO" && entry.settledCents > 0 && entry.balanceCents > 0 && (
          <p className="col-span-3 text-xs font-medium text-amber-700">
            {isRec ? "Recebimento parcial" : "Pagamento parcial"}: falta {formatBRL(entry.balanceCents)}
          </p>
        )}
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
        <Info
          label="Origem"
          value={
            isCardBill ? (
              <Badge tone="blue">Fatura do cartão</Badge>
            ) : entry.sourceKey ? (
              <Badge tone="blue">{entry.sourceKey.startsWith("ajuste:") ? "Ajuste da venda" : "Gerado automaticamente"}</Badge>
            ) : (
              <Badge>Lançamento manual</Badge>
            )
          }
        />
      </dl>
      {looseCardBill && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            Este lançamento está como &quot;Fatura do cartão&quot;, mas não está ligado a nenhum cartão, por isso não soma na fatura nem aparece no resultado (DRE). Use &quot;Ligar a um cartão&quot;.
          </p>
          {canLink && (
            <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
              Ligar a um cartão
            </Button>
          )}
          {!canLink && entry.settledCents > 0 && <p className="text-xs">Esta conta já tem pagamento registrado. Para ligar ao cartão, estorne o pagamento antes.</p>}
        </div>
      )}
      {isCardBill ? (
        <section>
          <h3 className="mb-2 font-semibold">Compras nesta fatura</h3>
          {purchases.length === 0 ? (
            <p className="text-muted">Nenhuma compra.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {purchases.map((line, i) => (
                <li key={i} className="p-2.5 text-slate-700">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        entry.notes && <p className="whitespace-pre-wrap rounded-lg border border-line p-3 text-slate-700">{entry.notes}</p>
      )}
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
                  {!s.reversedAt &&
                    s.cardBills.map((b) => (
                      <p key={b.payableId} className="text-xs">
                        Na fatura:{" "}
                        <Link className="font-medium text-brand-700 hover:underline" href={`/financeiro/pagar?abrir=${b.payableId}`}>
                          {b.description}
                        </Link>
                        {b.dueDate && ` — vence ${formatDate(b.dueDate)}`} — {formatBRL(b.cents)}
                      </p>
                    ))}
                  {!s.reversedAt && s.cardStartInstallment > 1 && (
                    <p className="text-xs text-muted">
                      Parcelas {s.cardStartInstallment} a {s.cardInstallments} de {s.cardInstallments} (as anteriores já estavam pagas)
                    </p>
                  )}
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
      {isCardBill ? (
        <p className="text-xs text-muted">O valor da fatura é a soma das compras no cartão. Para mudar, estorne a compra na conta de origem (ela sai da fatura) e lance de novo.</p>
      ) : (
        entry.sourceKey && !entry.sourceKey.startsWith("ajuste:") && <p className="text-xs text-muted">Valor controlado pela venda vinculada: para alterá-lo ou cancelá-lo, edite a venda.</p>
      )}
      {linking && (
        <LinkCardModal
          entry={entry}
          cards={accounts.filter((a) => a.type === "CARTAO_CREDITO")}
          expenseCategories={expenseCategories}
          onClose={() => setLinking(false)}
          onDone={() => (setLinking(false), reload())}
        />
      )}

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

type CardChoice = { installments: number; start: number; firstMonth: string };

/** Mês da 1ª fatura sugerido (compra nova: pela data; compra antiga: a fatura mais antiga que ainda não venceu). */
function suggestedFirstMonth(c: CardChoice, card: AccountOpt, date: string) {
  const closing = card.closingDay ?? 31;
  if (c.start <= 1) return billMonthOf(date || today(), closing);
  return oldPurchaseFirstBillMonth(today(), closing, card.dueDay);
}

/** O que mandar ao servidor: vazio quando é o mesmo que ele calcularia pela data da compra. */
function cardPayload(c: CardChoice, card: AccountOpt, date: string) {
  return {
    cardInstallments: c.installments,
    cardStartInstallment: c.start,
    cardFirstBillMonth: c.firstMonth || (c.start > 1 ? suggestedFirstMonth(c, card, date) : null),
  };
}

/** Campos do cartão da agência: parcelas, parcela inicial (compra antiga), primeira fatura e a prévia das faturas. */
function CardPlanFields({
  card,
  date,
  amountCents,
  value,
  onChange,
  purchaseWord = "compra",
}: {
  card: AccountOpt;
  date: string;
  amountCents: number;
  value: CardChoice;
  onChange: (v: CardChoice) => void;
  purchaseWord?: string;
}) {
  if (!card.closingDay || !card.dueDay)
    return <p className="rounded-lg bg-red-50 p-3 text-sm text-danger sm:col-span-2">Informe o dia de fechamento e o dia de vencimento do cartão &quot;{card.name}&quot; em Contas e saldos.</p>;
  const suggested = suggestedFirstMonth(value, card, date);
  const first = value.firstMonth || suggested;
  const months = Array.from({ length: 16 }, (_, i) => addBillMonths(suggested, i - 3));
  if (!months.includes(first)) months.unshift(first);
  const plan = amountCents > 0 ? cardPlan({ amountCents, installments: value.installments, startInstallment: value.start, firstMonth: first, closingDay: card.closingDay, dueDay: card.dueDay }) : [];
  const t = today();
  const overdue = plan.find((p) => p.dueDate < t);
  const before = plan.length && value.start > 1 ? amountCents - plan.reduce((sum, p) => sum + p.cents, 0) : 0;
  return (
    <>
      <Field label="Parcelas no cartão" hint="Cada parcela entra na fatura de um mês">
        <Select
          value={value.installments}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange({ ...value, installments: n, start: Math.min(value.start, n) });
          }}
        >
          {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n === 1 ? "À vista no cartão" : `Parcelado no cartão: ${n}x`}
            </option>
          ))}
        </Select>
      </Field>
      {value.installments > 1 && (
        <Field label={`Esta ${purchaseWord} está na parcela`} hint="Para compra antiga: se as parcelas 1 e 2 já foram pagas, escolha 3. Só as parcelas que faltam entram nas faturas.">
          <Select value={value.start} onChange={(e) => onChange({ ...value, start: Number(e.target.value) })}>
            {Array.from({ length: value.installments }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 (compra nova)" : `${n} de ${value.installments}`}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field
        label="Primeira fatura"
        hint={value.start > 1 ? "Sugerimos a fatura mais antiga que ainda não venceu. Mude se a parcela caiu em outro mês." : "Sugerimos pela data da compra. Mude se a parcela caiu em outro mês."}
      >
        <Select value={first} onChange={(e) => onChange({ ...value, firstMonth: e.target.value })}>
          {months.map((m) => (
            <option key={m} value={m}>
              {billMonthLabel(m)}
              {m === suggested ? " (sugerida)" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {plan.length > 0 && (
        <div className="rounded-lg border border-line p-3 text-sm sm:col-span-2">
          <p className="mb-1 font-medium">Vai entrar nas faturas do cartão {card.name}:</p>
          <ul className="space-y-0.5">
            {plan.map((p) => (
              <li key={p.n} className={`tabular ${p.dueDate < t ? "text-danger" : ""}`}>
                {p.label} · vence {formatDate(p.dueDate)} · {formatBRL(p.cents)}
                {p.of > 1 && ` (${p.n}/${p.of})`}
              </li>
            ))}
          </ul>
          {before > 0 && (
            <p className="mt-2 text-xs text-muted">
              {value.start === 2 ? "A parcela 1" : `As parcelas 1 a ${value.start - 1}`} ({formatBRL(before)}) já {value.start === 2 ? "foi paga" : "foram pagas"} antes e não{" "}
              {value.start === 2 ? "entra" : "entram"} nas faturas.
            </p>
          )}
          {overdue && <p className="mt-2 text-xs font-medium text-danger">Atenção: a fatura de {overdue.label} já venceu. Se essa parcela já foi paga, comece pela parcela seguinte.</p>}
        </div>
      )}
    </>
  );
}

/** Lançamento antigo com a categoria "Fatura do cartão": escolhe o cartão, a fatura e a categoria real da despesa. */
function LinkCardModal({ entry, cards, expenseCategories, onClose, onDone }: { entry: Entry; cards: AccountOpt[]; expenseCategories: CatOpt[]; onClose: () => void; onDone: () => void }) {
  const { run, busy } = useAction();
  const [accountId, setAccountId] = useState(cards[0]?.id ?? "");
  const card = cards.find((c) => c.id === accountId);
  const suggested = card?.closingDay && card?.dueDay ? billMonthForDueDate(entry.dueDate, card.closingDay, card.dueDay) : entry.dueDate.slice(0, 7);
  const [billMonth, setBillMonth] = useState("");
  const month = billMonth || suggested;
  const months = Array.from({ length: 16 }, (_, i) => addBillMonths(suggested, i - 6));
  const firstCategory = expenseCategories.find((c) => c.value !== CARD_BILL_CATEGORY)?.value ?? "FORNECEDORES";
  const [category, setCategory] = useState(expenseCategories.length === 0 || expenseCategories.some((c) => c.value === "FORNECEDORES") ? "FORNECEDORES" : firstCategory);
  return (
    <Modal
      open
      onClose={onClose}
      title="Ligar a um cartão"
      description={`${entry.description} · ${formatBRL(entry.amountCents)}. A conta fica paga e o valor entra na fatura escolhida do cartão.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!accountId || !category} onClick={() => run(() => linkPayableToCardAction(entry.id, { accountId, billMonth: month, category }), { onSuccess: onDone })}>
            Ligar
          </Button>
        </>
      }
    >
      {cards.length === 0 ? (
        <p className="text-sm text-muted">Nenhum cartão da agência cadastrado. Cadastre o cartão em Financeiro &gt; Contas e saldos.</p>
      ) : (
        <div className="grid gap-3">
          <Field label="Cartão">
            <Select value={accountId} onChange={(e) => (setAccountId(e.target.value), setBillMonth(""))}>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Em qual fatura cai" hint="Sugerimos a fatura que vence no mês do vencimento desta conta.">
            <Select value={month} onChange={(e) => setBillMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {billMonthLabel(m)}
                  {m === suggested ? " (sugerida)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Categoria da despesa" hint="A categoria de verdade (ex.: Fornecedores). Assim a despesa volta a aparecer no resultado (DRE).">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <CategoryOptions kind="payable" expense={expenseCategories} />
            </Select>
          </Field>
        </div>
      )}
    </Modal>
  );
}

function SettleForm({ kind, entry, accounts: allAccounts, onDone, onCancel }: { kind: Kind; entry: Entry; accounts: AccountOpt[]; onDone: () => void; onCancel: () => void }) {
  // cartão de crédito da agência só paga contas (fornecedor que só aceita cartão)
  const accounts = kind === "receivable" ? allAccounts.filter((a) => a.type !== "CARTAO_CREDITO") : allAccounts;
  const [d, setD] = useState({ date: today(), amountCents: entry.balanceCents, interestCents: 0, discountCents: 0, accountId: accounts[0]?.id ?? "", method: entry.method ?? "PIX", notes: "" });
  const [cardChoice, setCardChoice] = useState<CardChoice>({ installments: 1, start: 1, firstMonth: "" });
  const selected = accounts.find((a) => a.id === d.accountId);
  const isCard = selected?.type === "CARTAO_CREDITO";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  const isRec = kind === "receivable";
  const invoice = (entry as Entry & EntryExtra).invoice ?? null;
  // "valor desta conta neste mês": só em lançamento feito à mão (o gerado pela venda é controlado pela venda)
  const canChangeTotal = !entry.sourceKey && !invoice;
  const fromSale = !!entry.sourceKey && !entry.sourceKey.startsWith("ajuste:");
  const [changeTotal, setChangeTotal] = useState(false);
  const [newTotal, setNewTotal] = useState(entry.amountCents);
  const [amountTouched, setAmountTouched] = useState(false);
  const total = canChangeTotal && changeTotal ? newTotal : entry.amountCents;
  const balance = Math.max(total - entry.settledCents, 0);
  const principal = settlementPrincipalSafe(d.amountCents, d.interestCents, d.discountCents);
  const remaining = balance - principal;
  const partial = principal > 0 && remaining > 0;
  const word = isRec ? "recebimento" : "pagamento";
  const payAll = !amountTouched || (principal === balance && d.discountCents === 0 && d.interestCents === 0);

  function setTotal(v: number) {
    setNewTotal(v);
    if (!amountTouched) setD((cur) => ({ ...cur, amountCents: Math.max(v - entry.settledCents, 0) }));
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const payload = {
          ...d,
          newTotalCents: canChangeTotal && changeTotal && newTotal !== entry.amountCents ? newTotal : null,
          ...(isCard && selected ? cardPayload(cardChoice, selected, d.date) : {}),
        };
        const r = await run(() => settleEntryAction(kind, entry.id, payload), { onSuccess: onDone });
        if (!r.ok) setErrors(issuesToMap(r.issues));
      }}
    >
      <div className="space-y-3 rounded-lg bg-slate-50 p-3 text-sm">
        <p>
          Saldo em aberto: <strong className="tabular">{formatBRL(balance)}</strong>
          {entry.settledCents > 0 && (
            <span className="text-muted">
              {" "}
              (já {isRec ? "recebido" : "pago"}: {formatBRL(entry.settledCents)})
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={payAll ? "primary" : "outline"}
            onClick={() => {
              setAmountTouched(false);
              setD({ ...d, amountCents: balance, interestCents: 0, discountCents: 0 });
            }}
          >
            {isRec ? "Receber tudo" : "Pagar tudo"} ({formatBRL(balance)})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={payAll ? "outline" : "primary"}
            onClick={() => {
              setAmountTouched(true);
              setD({ ...d, amountCents: 0 });
              setTimeout(() => {
                const el = document.getElementById("settle-amount") as HTMLInputElement | null;
                el?.focus();
                el?.select();
              }, 0);
            }}
          >
            {isRec ? "Receber só uma parte" : "Pagar só uma parte"}
          </Button>
        </div>
      </div>

      {canChangeTotal && (
        <div className="rounded-lg border border-line p-3 text-sm">
          {!changeTotal ? (
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setChangeTotal(true)}>
              O valor desta conta mudou este mês?
            </button>
          ) : (
            <Field
              label="Valor desta conta neste mês"
              error={errors.newTotalCents}
              hint={
                <>
                  Ex.: VT ou comissão que muda todo mês. Só esta conta muda; os próximos meses continuam com o valor de antes.
                  {entry.settledCents > 0 && ` Já ${isRec ? "recebido" : "pago"}: ${formatBRL(entry.settledCents)}.`}
                </>
              }
            >
              <MoneyInput value={newTotal} onChange={setTotal} />
            </Field>
          )}
        </div>
      )}
      {fromSale && entry.sale && (
        <p className="rounded-lg bg-brand-25 p-3 text-sm text-brand-900">
          Valor definido pela venda {entry.sale.code}.{" "}
          {entry.origin === "COMISSAO_VENDEDOR"
            ? "Se o valor mudou, altere na venda, em Comissão do vendedor."
            : entry.origin === "CUSTO_VENDA"
              ? "Se o valor mudou, altere o custo do produto na venda."
              : "Se o valor mudou, altere na venda."}{" "}
          <Link className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" href={`/vendas/${entry.sale.id}`}>
            Abrir venda <ExternalLink className="h-3 w-3" />
          </Link>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={isRec ? "Valor recebido" : "Valor pago"} required error={errors.amountCents} hint="Pode ser menos que o saldo. O que faltar continua em aberto para pagar depois.">
          <MoneyInput
            id="settle-amount"
            value={d.amountCents}
            onChange={(v) => {
              setAmountTouched(true);
              setD({ ...d, amountCents: v });
            }}
            autoFocus
          />
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
        <Field label="Conta financeira" required error={errors.accountId} className="sm:col-span-2">
          <Select value={d.accountId} onChange={(e) => (setD({ ...d, accountId: e.target.value }), setCardChoice({ ...cardChoice, firstMonth: "" }))}>
            {accounts.length === 0 && <option value="">Cadastre uma conta em Contas e transferências</option>}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.type === "CARTAO_CREDITO" ? " (cartão da agência)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {isCard && selected ? (
          <CardPlanFields card={selected} date={d.date} amountCents={d.amountCents} value={cardChoice} onChange={setCardChoice} purchaseWord="conta" />
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
      <div className={`rounded-lg p-3 text-sm ${remaining < 0 ? "bg-red-50 text-danger" : partial ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-900"}`}>
        {remaining < 0 ? (
          "Valor acima do saldo em aberto."
        ) : principal <= 0 ? (
          `Informe quanto foi ${isRec ? "recebido" : "pago"} agora.`
        ) : partial ? (
          <>
            <strong>{isRec ? "Recebimento parcial" : "Pagamento parcial"}:</strong> depois de confirmar, ainda {isRec ? "faltará receber" : "faltarão"}{" "}
            <strong className="tabular">{formatBRL(remaining)}</strong>.
          </>
        ) : (
          "A conta ficará quitada."
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Voltar
        </Button>
        <Button type="submit" loading={busy} disabled={remaining < 0 || principal <= 0 || !d.accountId}>
          {partial ? `Confirmar ${word} parcial` : `Confirmar ${word}`}
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
        <Field label="Valor" hint={entry.origin === "CARTAO" ? "Soma das compras no cartão" : entry.sourceKey ? "Definido pela venda" : undefined}>
          <MoneyInput value={d.amountCents} onChange={(v) => setD({ ...d, amountCents: v })} disabled={!!entry.sourceKey} />
        </Field>
        <Field label="Vencimento" hint={extra.invoice ? "Definido pela fatura" : undefined}>
          <Input type="date" value={d.dueDate} disabled={!!extra.invoice} onChange={(e) => setD({ ...d, dueDate: e.target.value })} />
        </Field>
        {kind === "payable" && entry.origin === "CARTAO" ? (
          <Field label="Categoria" hint="Preenchida pelo sistema na fatura do cartão.">
            <Input value={PAYABLE_CATEGORIES.label(entry.category)} disabled />
          </Field>
        ) : (
          <Field
            label="Categoria"
            hint={kind === "payable" && d.category === CARD_BILL_CATEGORY ? 'Lançamento antigo, não ligado a cartão. Se foi pago com o cartão da agência, use "Ligar a um cartão" no detalhe da conta.' : undefined}
          >
            <Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })}>
              {kind === "payable" && entry.category === CARD_BILL_CATEGORY && <option value={CARD_BILL_CATEGORY}>{PAYABLE_CATEGORIES.label(CARD_BILL_CATEGORY)} (antigo)</option>}
              <CategoryOptions kind={kind} expense={expenseCategories} />
            </Select>
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

export function NewEntryButton({ kind, options, todayStr }: { kind: Kind; todayStr: string; options: { clients: Opt[]; suppliers: Opt[]; costCenters?: Opt[]; expenseCategories?: CatOpt[]; accounts?: AccountOpt[] } }) {
  companyToday = todayStr;
  const [open, setOpen] = useState(false);
  const isRec = kind === "receivable";
  const init = { description: "", partyId: "", category: isRec ? "OUTRAS_RECEITAS" : "ADMINISTRATIVAS", amountCents: 0, firstDueDate: today(), installments: 1, recurringMonths: 1, method: "", notes: "", costCenterId: "", mode: "unico" as "unico" | "parcelado" | "recorrente" };
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  // "Como foi pago": vazio = fica em aberto; um cartão = compra já feita no cartão da agência
  const cards = isRec ? [] : (options.accounts ?? []).filter((a) => a.type === "CARTAO_CREDITO");
  const [cardId, setCardId] = useState("");
  const [cardChoice, setCardChoice] = useState<CardChoice>({ installments: 1, start: 1, firstMonth: "" });
  const card = cards.find((c) => c.id === cardId) ?? null;

  const submit = async () => {
    if (card) {
      const c = cardPayload(cardChoice, card, d.firstDueDate);
      const payload = {
        description: d.description,
        category: d.category,
        amountCents: d.amountCents,
        firstDueDate: d.firstDueDate,
        notes: d.notes,
        costCenterId: d.costCenterId || null,
        supplierId: d.partyId || null,
        card: { accountId: card.id, installments: c.cardInstallments, startInstallment: c.cardStartInstallment, firstBillMonth: c.cardFirstBillMonth },
      };
      const r = await run(() => createPayableAction(payload), {
        onSuccess: () => (setOpen(false), setD(init), setCardId(""), setCardChoice({ installments: 1, start: 1, firstMonth: "" })),
      });
      if (!r.ok) setErrors(issuesToMap(r.issues));
      return;
    }
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
          {cards.length > 0 && (
            <Field label="Como foi pago" className="sm:col-span-2" hint="Escolha o cartão se a compra já foi feita no cartão da agência. A conta fica paga e o valor vai para a fatura do cartão.">
              <Select value={cardId} onChange={(e) => (setCardId(e.target.value), setCardChoice({ ...cardChoice, firstMonth: "" }))}>
                <option value="">Vou pagar depois (fica em aberto)</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {/^cart[aã]o/i.test(c.name) ? c.name : `Cartão: ${c.name}`}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {card && (
            <p className="rounded-lg bg-brand-25 p-3 text-xs text-brand-900 sm:col-span-2">
              Parcelado no cartão vira uma conta só (já paga) e as parcelas aparecem nas faturas do cartão, uma por mês. Se a venda dessa compra está cadastrada no sistema, não lance de novo aqui:
              abra a conta a pagar do fornecedor dessa venda e clique em Registrar pagamento com o cartão.
            </p>
          )}
          <Field label={card ? "Valor total da compra" : d.mode === "recorrente" ? "Valor mensal" : "Valor total"} required error={errors.amountCents}>
            <MoneyInput value={d.amountCents} onChange={(v) => setD({ ...d, amountCents: v })} />
          </Field>
          <Field label={card ? "Data da compra" : d.mode === "unico" ? "Vencimento" : "1º vencimento"} required error={errors.firstDueDate}>
            <Input type="date" value={d.firstDueDate} onChange={(e) => setD({ ...d, firstDueDate: e.target.value })} />
          </Field>
          {card && <CardPlanFields card={card} date={d.firstDueDate} amountCents={d.amountCents} value={cardChoice} onChange={setCardChoice} />}
          {!card && (
          <Field label="Condição">
            <Select value={d.mode} onChange={(e) => setD({ ...d, mode: e.target.value as typeof d.mode })}>
              <option value="unico">Pagamento único</option>
              <option value="parcelado">Parcelado</option>
              {!isRec && <option value="recorrente">Recorrente (mensal)</option>}
            </Select>
          </Field>
          )}
          {!card && d.mode === "parcelado" && (
            <Field label="Número de parcelas" hint={d.amountCents ? `≈ ${formatBRL(Math.floor(d.amountCents / d.installments))} cada` : undefined}>
              <Input type="number" min={2} max={48} value={d.installments} onChange={(e) => setD({ ...d, installments: Number(e.target.value) })} />
            </Field>
          )}
          {!card && d.mode === "recorrente" && (
            <Field label="Repetir por (meses)">
              <Input type="number" min={2} max={36} value={d.recurringMonths} onChange={(e) => setD({ ...d, recurringMonths: Number(e.target.value) })} />
            </Field>
          )}
          {!card && (
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
          )}
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
