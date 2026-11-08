"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Search,
  UserPlus,
  Lock,
  Wand2,
  Info,
  CheckCircle2,
  Users,
  Package,
  Wallet,
  CreditCard,
  Map,
  Sparkles,
  CircleDashed,
  UserRound,
  Bus,
} from "lucide-react";
import { Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal, MoneyInput } from "@/components/ui/client";
import { ClientForm } from "@/components/forms/client-form";
import { useAction, issuesToMap } from "@/components/use-action";
import { createSaleAction, createTripAction, searchClientsAction, tripOptionsAction, updateSaleAction } from "@/app/actions";
import { calculateSale, itemCharge } from "@/lib/finance";
import { applyBps, formatBRL, formatPercentBps, splitInstallments, sum } from "@/lib/money";
import { addMonths } from "@/lib/dates";
import {
  AGENCY_REVENUE_MODELS,
  COMMERCIAL_MODEL_HELP,
  PAYMENT_METHODS,
  PRODUCT_TYPES,
  SUPPLIER_CASH_METHODS,
  SUPPLIER_PAYMENTS,
  SUPPLIER_PAYMENT_HELP,
  type CommercialModel,
  type SupplierPayment,
} from "@/lib/constants";
import { billMonthLabel, billMonthOf, cardPlan } from "@/lib/card-bills";
import { cn, formatDocument, newKey } from "@/lib/utils";
import { AiImport } from "./ai-import";
import type { SaleExtraction } from "@/server/services/ai-extract";

type Item = {
  uid: string;
  id?: string | null;
  productType: string;
  description: string;
  supplierId: string;
  operatorId: string;
  commercialModel: CommercialModel;
  priceCents: number;
  costCents: number;
  supplierCommissionCents: number;
  ravCents: number;
  duCents: number;
  overCents: number;
  cardFeeCents: number;
  supplierDueDate: string;
  locator: string;
  /** enquanto true, comissão e over seguem a regra cadastrada para o fornecedor/produto */
  autoRule?: boolean;
  /** só na tela: compra antiga no cartão (já tem parcelas pagas antes do sistema) */
  cardOld?: boolean;
} & SupplierPayFields;
/** Como a agência paga o fornecedor (vazio = não escolhido). */
type SupplierPayFields = {
  supplierPayment: SupplierPayment;
  supplierPayMethod: string;
  supplierCardAccountId: string;
  supplierCardInstallments: number;
  supplierCardStartInstallment: number;
  supplierCardFirstBillMonth: string;
};
type AgencyCard = { id: string; name: string; closingDay: number | null; dueDay: number | null; ready: boolean };
type Payment = { key: string; dueDate: string; amountCents: number; method: string; description?: string | null; payerClientId?: string | null };
type Passenger = { uid: string; name: string; document: string; birthDate: string; passportNumber: string; passportExpiry: string; clientId?: string | null; room?: string | null; seat?: string | null };
type ClientRef = { id: string; name: string; document?: string | null; docHint?: string | null; whatsapp?: string | null };
type Rule = { supplierId: string | null; productType: string | null; description: string | null; commissionBps: number; overBps: number };
type Excursion = { id: string; code: string; name: string; destination: string; startDate: string; endDate: string; pricePerSeatCents: number; seats: number };

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
  tripId?: string | null;
  excursionId?: string | null;
  intermediaryId?: string | null;
  intermediaryCommissionCents?: number;
  commission: { mode: "VALOR"; amountCents: number } | { mode: "PERCENTUAL"; bps: number };
  items: (Omit<Item, "uid" | keyof SupplierPayFields> & Partial<SupplierPayFields>)[];
  payments: Payment[];
  passengers: Omit<Passenger, "uid">[];
  people?: ClientRef[]; // pagantes/passageiros já vinculados
  locked: Record<string, number>;
};

const blankItem = (patch: Partial<Item> = {}): Item => ({
  uid: newKey(),
  productType: "PACOTE",
  description: "",
  supplierId: "",
  operatorId: "",
  commercialModel: "INTERMEDIACAO",
  priceCents: 0,
  costCents: 0,
  supplierCommissionCents: 0,
  ravCents: 0,
  duCents: 0,
  overCents: 0,
  cardFeeCents: 0,
  supplierDueDate: "",
  locator: "",
  autoRule: true,
  supplierPayment: "FATURADO",
  supplierPayMethod: "",
  supplierCardAccountId: "",
  supplierCardInstallments: 1,
  supplierCardStartInstallment: 1,
  supplierCardFirstBillMonth: "",
  ...(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<Item>),
});

/** Produto vindo do servidor: completa os campos novos e mantém o modelo Comissão como "cliente paga direto". */
function itemFromInitial(i: SaleFormInitial["items"][number]): Item {
  const item = blankItem({ ...i, autoRule: false });
  if (item.commercialModel === "COMISSAO") item.supplierPayment = "CLIENTE_DIRETO";
  item.cardOld = item.supplierCardInstallments > 1 && (item.supplierCardStartInstallment > 1 || !!item.supplierCardFirstBillMonth);
  return item;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Prévia das faturas do cartão em que a compra cai. */
function cardPreview(i: Item, card: AgencyCard | undefined, saleDate: string) {
  if (!card?.closingDay || !card.dueDay || i.costCents <= 0) return null;
  const installments = Math.max(1, i.supplierCardInstallments);
  const isOld = !!i.cardOld && installments > 1; // "venda antiga" só vale com mais de uma parcela, igual ao envio
  const start = Math.min(Math.max(1, isOld ? i.supplierCardStartInstallment : 1), installments);
  const date = i.supplierDueDate || saleDate;
  const firstMonth = (isOld && i.supplierCardFirstBillMonth) || billMonthOf(date, card.closingDay);
  const plan = cardPlan({ amountCents: i.costCents, installments, startInstallment: start, firstMonth, closingDay: card.closingDay, dueDay: card.dueDay });
  if (!plan.length) return null;
  const labels = plan.map((p) => p.label);
  const where =
    labels.length === 1
      ? `Entra na fatura de ${labels[0]}`
      : labels.length <= 4
        ? `Entra em ${labels.length} faturas: ${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`
        : `Entra em ${labels.length} faturas, de ${labels[0]} a ${labels[labels.length - 1]}`;
  const each = plan.length > 1 || installments > 1 ? ` · parcelas de ${formatBRL(plan[plan.length - 1].cents)}` : "";
  const old = start > 1 ? ` (parcelas ${start} a ${installments}; as anteriores já estavam pagas)` : "";
  return `${where}${each}${old}.`;
}

function pickRule(rules: Rule[], supplierId: string, productType: string) {
  return (
    rules.find((r) => r.supplierId && r.supplierId === supplierId && r.productType === productType) ??
    rules.find((r) => r.supplierId && r.supplierId === supplierId && !r.productType) ??
    rules.find((r) => !r.supplierId && r.productType === productType) ??
    null
  );
}

function Section({ icon: Icon, title, description, children, aside, step }: { icon: React.ElementType; title: string; description?: string; children: React.ReactNode; aside?: React.ReactNode; step?: number }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="h-4 w-4" />
            {step && <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-600 text-[10px] font-semibold text-white ring-2 ring-white">{step}</span>}
          </span>
          <div>
            <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
            {description && <p className="text-xs text-muted">{description}</p>}
          </div>
        </div>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </Card>
  );
}

/** Busca/cadastro de pessoa (cliente, pagante ou passageiro). */
function PersonSearch({ onPick, placeholder = "Buscar por nome, CPF/CNPJ, passaporte ou WhatsApp…", error, autoFocus }: { onPick: (c: ClientRef) => void; placeholder?: string; error?: string; autoFocus?: boolean }) {
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
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            className={cn("pl-9", error && "border-danger")}
            placeholder={placeholder}
            value={q}
            autoFocus={autoFocus}
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
        <ul className="absolute z-30 mt-1 max-h-64 w-full animate-pop-in overflow-auto rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-pop)]">
          {results.length === 0 && <li className="px-3 py-3 text-sm text-muted">Nenhum cadastro encontrado. Use “Novo” para cadastrar.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50" onMouseDown={() => onPick(c)}>
                <span className="block text-sm font-medium">{c.name}</span>
                <span className="block text-xs text-muted">{[c.document ? formatDocument(c.document) : c.docHint, c.whatsapp].filter(Boolean).join(" · ") || "sem documento"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Novo cadastro" description="Cadastro rápido — complete os demais dados depois." size="lg">
        <ClientForm
          compact
          initial={{ name: /\d/.test(q) ? "" : q }}
          onCancel={() => setCreating(false)}
          onSaved={(c) => {
            onPick({ id: c.id, name: c.name });
            setCreating(false);
          }}
        />
      </Modal>
    </div>
  );
}

function ClientPicker({ value, onChange, error }: { value: ClientRef | null; onChange: (c: ClientRef | null) => void; error?: string }) {
  if (value)
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-25 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-600 ring-1 ring-brand-100">
            <UserRound className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{value.name}</p>
            <p className="text-xs text-muted">{[value.document ? formatDocument(value.document) : value.docHint, value.whatsapp].filter(Boolean).join(" · ") || "Sem documento cadastrado"}</p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );
  return <PersonSearch onPick={onChange} error={error} />;
}

export function SaleForm({
  initial,
  suppliers,
  sellers,
  canPickSeller,
  showMargin,
  rules = [],
  excursions = [],
  agencyCards = [],
  fredyCardId,
  balcaoFlowId,
  afterSaveHref,
}: {
  initial: SaleFormInitial;
  suppliers: { id: string; name: string; category?: string }[];
  sellers: { id: string; name: string; commissionRateBps: number }[];
  canPickSeller: boolean;
  showMargin: boolean;
  rules?: Rule[];
  excursions?: Excursion[];
  /** cartões de crédito da agência (para "como o fornecedor é pago") */
  agencyCards?: AgencyCard[];
  /** venda feita a partir de um card do Frédy (tela do vendedor): fica ligada ao card */
  fredyCardId?: string | null;
  /** venda lançada dentro de um atendimento da venda rápida: fica ligada a ele */
  balcaoFlowId?: string | null;
  /** para onde ir depois de salvar; ":id" vira o id da venda */
  afterSaveHref?: string;
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
    tripId: initial.tripId ?? "",
    excursionId: initial.excursionId ?? "",
    intermediaryId: initial.intermediaryId ?? "",
  });
  const [items, setItems] = useState<Item[]>(initial.items.length ? initial.items.map(itemFromInitial) : [blankItem()]);
  // produtos que já estavam no cartão da agência numa venda confirmada (a compra já está na fatura)
  const cardAlready = useMemo(
    () => new Set(isDraft ? [] : initial.items.filter((i) => i.id && i.supplierPayment === "CARTAO_AGENCIA").map((i) => i.id as string)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [fees, setFees] = useState(initial.feesCents);
  const [discount, setDiscount] = useState(initial.discountCents);
  const [interComm, setInterComm] = useState(initial.intermediaryCommissionCents ?? 0);
  const [commission, setCommission] = useState(initial.commission);
  const [payments, setPayments] = useState<Payment[]>(initial.payments);
  const [planTouched, setPlanTouched] = useState(editing);
  const [gen, setGen] = useState({ method: "PIX", entryCents: 0, installments: 1, firstDue: initial.saleDate });
  const [passengers, setPassengers] = useState<Passenger[]>(initial.passengers.map((p) => ({ ...p, uid: newKey() })));
  const [people, setPeople] = useState<ClientRef[]>(initial.people ?? []);
  const [payerModal, setPayerModal] = useState(false);
  const [paxModal, setPaxModal] = useState<string | null>(null);
  const [trips, setTrips] = useState<{ id: string; code: string; title: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const firstClient = useRef(true);

  const intermediaries = suppliers.filter((s) => s.category === "INTERMEDIARIO");
  const tourSuppliers = suppliers.filter((s) => s.category !== "INTERMEDIARIO");
  const operators = suppliers.filter((s) => s.category === "OPERADORA" || s.category === "CONSOLIDADORA");
  const excursion = excursions.find((e) => e.id === g.excursionId);

  // Viagens do cliente (para agrupar vendas)
  useEffect(() => {
    if (!client) {
      setTrips([]);
      return;
    }
    tripOptionsAction(client.id).then((r) => r.ok && setTrips(r.data.trips));
    if (!firstClient.current) setG((x) => ({ ...x, tripId: "" }));
    firstClient.current = false;
  }, [client]);

  const totals = useMemo(
    () =>
      calculateSale(
        items.map((i) => ({
          commercialModel: i.commercialModel,
          priceCents: i.priceCents,
          costCents: i.commercialModel === "COMISSAO" ? 0 : i.costCents,
          supplierCommissionCents: i.commercialModel === "COMISSAO" ? i.supplierCommissionCents : 0,
          ravCents: i.ravCents,
          duCents: i.duCents,
          overCents: i.overCents,
          cardFeeCents: i.commercialModel === "COMISSAO" ? i.cardFeeCents : 0,
        })),
        fees,
        discount,
        commission,
        interComm,
      ),
    [items, fees, discount, commission, interComm],
  );
  const planTotal = sum(payments.map((p) => p.amountCents));
  const diff = totals.clientPayableCents - planTotal;
  const ravDu = sum(items.map((i) => i.ravCents + i.duCents));
  const over = sum(items.map((i) => i.overCents));

  function generate(target = totals.clientPayableCents, cfg = gen) {
    const lockedRows = payments.filter((p) => initial.locked[p.key]);
    const remaining = target - sum(lockedRows.map((p) => p.amountCents));
    if (remaining <= 0) return setPayments(lockedRows);
    const payer = payments.find((p) => !initial.locked[p.key])?.payerClientId ?? null;
    const rows: Payment[] = [];
    const entry = Math.min(cfg.entryCents, remaining);
    if (entry > 0) rows.push({ key: newKey(), dueDate: cfg.firstDue, amountCents: entry, method: cfg.method, description: null, payerClientId: payer });
    const rest = remaining - entry;
    const n = Math.max(1, cfg.installments);
    if (rest > 0)
      splitInstallments(rest, n).forEach((amount, i) =>
        rows.push({ key: newKey(), dueDate: addMonths(cfg.firstDue, entry > 0 ? i + 1 : i), amountCents: amount, method: cfg.method, description: null, payerClientId: payer }),
      );
    setPayments([...lockedRows, ...rows]);
  }

  useEffect(() => {
    if (!planTouched) generate(totals.clientPayableCents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totals.clientPayableCents, planTouched]);

  useEffect(() => {
    if (editing) return;
    const s = sellers.find((x) => x.id === g.sellerId);
    if (s && s.commissionRateBps > 0 && commission.mode === "PERCENTUAL") setCommission({ mode: "PERCENTUAL", bps: s.commissionRateBps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.sellerId]);

  /** Atualiza o produto e reaplica a regra de comissão/over enquanto o usuário não editar esses valores. */
  const updateItem = (uid: string, patch: Partial<Item>) =>
    setItems((list) =>
      list.map((i) => {
        if (i.uid !== uid) return i;
        const next = { ...i, ...patch };
        if (next.autoRule) {
          const rule = pickRule(rules, next.operatorId || next.supplierId, next.productType) ?? pickRule(rules, next.supplierId, next.productType);
          if (rule) {
            if (next.commercialModel === "COMISSAO") next.supplierCommissionCents = applyBps(next.priceCents, rule.commissionBps);
            next.overCents = applyBps(next.priceCents, rule.overBps);
          }
        }
        return next;
      }),
    );

  /** Troca "como o fornecedor é pago" mantendo o modelo comercial coerente. */
  function changeSupplierPayment(i: Item, pay: SupplierPayment) {
    const patch: Partial<Item> = { supplierPayment: pay };
    if (pay === "CLIENTE_DIRETO") patch.commercialModel = "COMISSAO";
    else if (i.commercialModel === "COMISSAO") patch.commercialModel = "INTERMEDIACAO";
    if (pay === "A_VISTA" && !i.supplierPayMethod) patch.supplierPayMethod = "PIX";
    if (pay === "CARTAO_AGENCIA" && !i.supplierCardAccountId) patch.supplierCardAccountId = agencyCards.find((c) => c.ready)?.id ?? "";
    updateItem(i.uid, patch);
  }

  /** Liga/desliga "compra antiga" no cartão: sugere a fatura em aberto hoje. */
  function toggleCardOld(i: Item, on: boolean) {
    const card = agencyCards.find((c) => c.id === i.supplierCardAccountId);
    updateItem(
      i.uid,
      on
        ? { cardOld: true, supplierCardStartInstallment: Math.min(2, Math.max(1, i.supplierCardInstallments)), supplierCardFirstBillMonth: card?.closingDay ? billMonthOf(todayIso(), card.closingDay) : "" }
        : { cardOld: false, supplierCardStartInstallment: 1, supplierCardFirstBillMonth: "" },
    );
  }

  function pickExcursion(id: string) {
    const e = excursions.find((x) => x.id === id);
    setG((x) => ({ ...x, excursionId: id, ...(e ? { destination: e.destination, tripStart: e.startDate, tripEnd: e.endDate } : {}) }));
    if (e) {
      const pax = Number(g.passengerCount) || 1;
      setItems([blankItem({ productType: "EXCURSAO", description: `${e.code} · ${e.name}`, commercialModel: "REVENDA", priceCents: e.pricePerSeatCents * pax, autoRule: false })]);
    }
  }

  async function createTrip() {
    if (!client) return;
    const r = await run(() => createTripAction({ clientId: client.id, title: g.destination ? `Viagem ${g.destination}` : `Viagem de ${client.name.split(" ")[0]}`, destination: g.destination || null }), { refresh: false });
    if (r.ok) {
      setTrips((t) => [{ id: r.data.id, code: r.data.code, title: g.destination ? `Viagem ${g.destination}` : "Nova viagem" }, ...t]);
      setG((x) => ({ ...x, tripId: r.data.id }));
    }
  }

  async function submit(confirm: boolean) {
    if (!client) {
      setErrors({ clientId: "Selecione ou cadastre o cliente." });
      return;
    }
    const payload = {
      saleDate: g.saleDate,
      clientId: client.id,
      sellerId: g.sellerId || null,
      destination: g.destination,
      tripStart: g.tripStart || null,
      tripEnd: g.tripEnd || null,
      passengerCount: Number(g.passengerCount) || 1,
      locator: g.locator,
      notes: g.notes,
      feesCents: fees,
      discountCents: discount,
      tripId: g.tripId || null,
      excursionId: g.excursionId || null,
      intermediaryId: g.intermediaryId || null,
      intermediaryCommissionCents: g.intermediaryId ? interComm : 0,
      commission,
      items: items.map(({ uid: _uid, autoRule: _a, cardOld, ...i }) => ({
        ...i,
        id: i.id ?? null,
        supplierId: i.supplierId || null,
        operatorId: i.operatorId || null,
        supplierDueDate: i.supplierDueDate || null,
        supplierPayMethod: i.supplierPayment === "A_VISTA" ? i.supplierPayMethod || null : null,
        supplierCardAccountId: i.supplierPayment === "CARTAO_AGENCIA" ? i.supplierCardAccountId || null : null,
        supplierCardInstallments: i.supplierPayment === "CARTAO_AGENCIA" ? i.supplierCardInstallments : 1,
        supplierCardStartInstallment: i.supplierPayment === "CARTAO_AGENCIA" && cardOld && i.supplierCardInstallments > 1 ? i.supplierCardStartInstallment : 1,
        supplierCardFirstBillMonth: i.supplierPayment === "CARTAO_AGENCIA" && cardOld && i.supplierCardInstallments > 1 ? i.supplierCardFirstBillMonth || null : null,
        costCents: i.commercialModel === "COMISSAO" ? 0 : i.costCents,
        supplierCommissionCents: i.commercialModel === "COMISSAO" ? i.supplierCommissionCents : 0,
        cardFeeCents: i.commercialModel === "COMISSAO" ? i.cardFeeCents : 0,
      })),
      payments: payments.map((p) => ({ key: p.key, dueDate: p.dueDate, amountCents: p.amountCents, method: p.method, description: p.description ?? null, payerClientId: p.payerClientId || null })),
      passengers: passengers.filter((p) => p.name.trim()).map(({ uid: _u, ...p }) => ({ ...p, clientId: p.clientId || null })),
      confirm,
    };
    const r = await run(() => (editing ? updateSaleAction(initial.id!, payload) : createSaleAction(payload, { fredyCardId, balcaoFlowId })), {
      refresh: false,
      onSuccess: (d) => {
        if (d.warnings?.length) setTimeout(() => alert(`Venda salva. Atenção:\n\n${d.warnings.join("\n\n")}`), 50);
        router.push(afterSaveHref ? afterSaveHref.replace(":id", d.id) : `/vendas/${d.id}`);
      },
    });
    if (!r.ok) setErrors(issuesToMap(r.issues));
  }

  /** Aplica os dados lidos do print pela IA (só preenche; o vendedor revisa antes de salvar). */
  function applyExtraction(d: SaleExtraction) {
    if (d.client.match) setClient(d.client.match);
    setG((v) => ({
      ...v,
      destination: d.destination ?? v.destination,
      tripStart: d.tripStart ?? v.tripStart,
      tripEnd: d.tripEnd ?? v.tripEnd,
      locator: d.locator ?? v.locator,
      passengerCount: Math.max(d.passengers.length, 1),
      notes: [v.notes, d.notes ?? ""].filter(Boolean).join("\n"),
    }));
    if (d.items.length)
      setItems(
        d.items.map((i) =>
          blankItem({ productType: i.productType, description: i.description, supplierId: i.supplierId ?? "", priceCents: i.priceCents, costCents: i.costCents, locator: i.locator }),
        ),
      );
    if (d.passengers.length) setPassengers(d.passengers.map((p) => ({ uid: newKey(), name: p.name, document: p.document, birthDate: p.birthDate, passportNumber: "", passportExpiry: "" })));
  }

  const err = (k: string) => errors[k];
  const payerOptions = [...(client ? [client] : []), ...people.filter((p) => p.id !== client?.id)];

  // Etapas que exigem informação adicional (não bloqueiam o rascunho)
  const checklist = [
    { ok: !!client, label: "Cliente vinculado" },
    { ok: items.every((i) => i.priceCents > 0), label: "Produtos com valor" },
    { ok: items.every((i) => i.supplierId || i.commercialModel === "REVENDA"), label: "Fornecedor em cada produto" },
    { ok: !!g.destination && !!g.tripStart, label: "Destino e data da viagem" },
    { ok: !!g.locator || items.some((i) => i.locator), label: "Localizador da reserva" },
    { ok: passengers.filter((p) => p.name.trim()).length >= (Number(g.passengerCount) || 1), label: `Passageiros informados (${passengers.filter((p) => p.name.trim()).length}/${Number(g.passengerCount) || 1})` },
    { ok: totals.clientPayableCents === 0 || diff === 0, label: "Parcelas conferem com o valor" },
    {
      ok:
        items.every((i) => i.supplierPayment !== "CARTAO_AGENCIA" || (!!i.supplierCardAccountId && i.costCents > 0)) &&
        items.every((i) => i.supplierPayment !== "A_VISTA" || !!i.supplierPayMethod),
      label: "Forma de pagar o fornecedor completa",
    },
  ];

  return (
    <div className="grid gap-6 pb-24 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        {isDraft && <AiImport onApply={applyExtraction} />}
        <Section icon={Users} step={1} title="Cliente e viagem" description="Quem compra, para onde e quando.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4">
              <span className="mb-1.5 block text-xs font-medium text-slate-700">
                Cliente <span className="text-danger">*</span>
              </span>
              <ClientPicker value={client} onChange={setClient} error={err("clientId")} />
            </div>
            {excursions.length > 0 && (
              <Field label="Excursão / grupo (operação própria)" className="sm:col-span-2" hint={excursion ? `${excursion.seats} vagas · ${formatBRL(excursion.pricePerSeatCents)} por passageiro` : "Opcional: reserva de vagas em uma excursão da agência."}>
                <Select value={g.excursionId} onChange={(e) => pickExcursion(e.target.value)}>
                  <option value="">Não é excursão</option>
                  {excursions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.code} · {e.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Viagem (agrupamento de vendas)" className="sm:col-span-2" error={err("tripId")} hint="Junte aéreo, hotel e seguro comprados em momentos diferentes.">
              <div className="flex gap-2">
                <Select value={g.tripId} onChange={(e) => setG({ ...g, tripId: e.target.value })} disabled={!client}>
                  <option value="">{client ? "Sem viagem vinculada" : "Selecione o cliente primeiro"}</option>
                  {trips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code} · {t.title}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="outline" disabled={!client || busy} onClick={createTrip} title="Criar uma nova viagem para este cliente">
                  <Map className="h-4 w-4" /> Nova
                </Button>
              </div>
            </Field>
            <Field label="Destino" error={err("destination")} className="sm:col-span-2">
              <Input value={g.destination} onChange={(e) => setG({ ...g, destination: e.target.value })} placeholder="Ex.: Porto Seguro - BA" />
            </Field>
            <Field label="Data da venda" required error={err("saleDate")}>
              <Input type="date" value={g.saleDate} onChange={(e) => setG({ ...g, saleDate: e.target.value })} />
            </Field>
            <Field label="Passageiros" error={err("passengerCount")}>
              <Input
                type="number"
                min={1}
                value={g.passengerCount}
                onChange={(e) => {
                  const pax = Number(e.target.value);
                  setG({ ...g, passengerCount: pax });
                  if (excursion) setItems((list) => list.map((i, idx) => (idx === 0 && i.productType === "EXCURSAO" ? { ...i, priceCents: excursion.pricePerSeatCents * (pax || 1) } : i)));
                }}
              />
            </Field>
            <Field label="Início da viagem" error={err("tripStart")}>
              <Input type="date" value={g.tripStart} onChange={(e) => setG({ ...g, tripStart: e.target.value })} />
            </Field>
            <Field label="Retorno" error={err("tripEnd")}>
              <Input type="date" value={g.tripEnd} min={g.tripStart || undefined} onChange={(e) => setG({ ...g, tripEnd: e.target.value })} />
            </Field>
            {canPickSeller && (
              <Field label="Vendedor">
                <Select value={g.sellerId} onChange={(e) => setG({ ...g, sellerId: e.target.value })}>
                  {sellers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Localizador principal">
              <Input value={g.locator} onChange={(e) => setG({ ...g, locator: e.target.value })} placeholder="Nº da reserva" />
            </Field>
          </div>
        </Section>

        <Section
          icon={Package}
          step={2}
          title="Produtos e serviços"
          description="Aéreo, hospedagem, pacote, seguro, transfer… cada item com seu fornecedor e suas taxas."
          aside={
            <Button type="button" variant="secondary" size="sm" onClick={() => setItems([...items, blankItem()])}>
              <Plus className="h-4 w-4" /> Adicionar produto
            </Button>
          }
        >
          {err("items") && <p className="mb-3 text-sm text-danger">{err("items")}</p>}
          <div className="space-y-4">
            {items.map((i, idx) => {
              const rule = pickRule(rules, i.operatorId || i.supplierId, i.productType) ?? pickRule(rules, i.supplierId, i.productType);
              const extras = i.ravCents + i.duCents + i.overCents + i.cardFeeCents > 0 || !!i.operatorId || !!i.locator || !!i.supplierDueDate;
              return (
                <div key={i.uid} className="rounded-xl border border-line bg-slate-50/30 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone="blue">Produto {idx + 1}</Badge>
                      <span className="text-xs text-muted">cobrado do cliente: {formatBRL(itemCharge(i))}</span>
                    </div>
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
                      <Input value={i.description} onChange={(e) => updateItem(i.uid, { description: e.target.value })} placeholder="Ex.: Hotel 7 noites com café" />
                    </Field>
                    <Field label="Fornecedor">
                      <Select value={i.supplierId} onChange={(e) => updateItem(i.uid, { supplierId: e.target.value })}>
                        <option value="">Selecione…</option>
                        {tourSuppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Como o fornecedor é pago" className="sm:col-span-2" hint={SUPPLIER_PAYMENT_HELP[i.supplierPayment]}>
                      <Select value={i.supplierPayment} onChange={(e) => changeSupplierPayment(i, e.target.value as SupplierPayment)}>
                        {SUPPLIER_PAYMENTS.values.map((v) => (
                          <option key={v} value={v}>
                            {SUPPLIER_PAYMENTS.label(v)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Valor vendido ao cliente (R$)" required error={err(`items.${idx}.priceCents`)} hint="quanto o cliente paga por este produto">
                      <MoneyInput value={i.priceCents} onChange={(v) => updateItem(i.uid, { priceCents: v })} />
                    </Field>
                    {i.commercialModel === "COMISSAO" ? (
                      <Field label="Comissão do fornecedor para a agência (R$)" error={err(`items.${idx}.supplierCommissionCents`)} hint={rule && i.autoRule ? `regra do fornecedor: ${formatPercentBps(rule.commissionBps)}${rule.description ? ` (${rule.description})` : ""}` : `o que o fornecedor paga à agência${i.priceCents > 0 ? ` · ${formatPercentBps(Math.round((i.supplierCommissionCents * 10000) / i.priceCents))} do valor vendido` : ""}`}>
                        <MoneyInput value={i.supplierCommissionCents} onChange={(v) => updateItem(i.uid, { supplierCommissionCents: v, autoRule: false })} />
                      </Field>
                    ) : (
                      <Field label="Custo do fornecedor (R$)" error={err(`items.${idx}.costCents`)} hint={`o que a agência paga ao fornecedor${i.priceCents > 0 ? ` · lucro da agência: ${formatBRL(i.priceCents - i.costCents)}` : ""}`}>
                        <MoneyInput value={i.costCents} onChange={(v) => updateItem(i.uid, { costCents: v })} />
                      </Field>
                    )}
                  </div>
                  {i.supplierPayment === "A_VISTA" && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Como a agência pagou" required error={err(`items.${idx}.supplierPayMethod`)}>
                        <Select value={i.supplierPayMethod} onChange={(e) => updateItem(i.uid, { supplierPayMethod: e.target.value })}>
                          <option value="">Selecione…</option>
                          {SUPPLIER_CASH_METHODS.map((m) => (
                            <option key={m} value={m}>
                              {PAYMENT_METHODS.label(m)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Data do pagamento ao fornecedor" hint="Se vazio, usa a data da venda.">
                        <Input type="date" value={i.supplierDueDate} onChange={(e) => updateItem(i.uid, { supplierDueDate: e.target.value })} />
                      </Field>
                    </div>
                  )}
                  {i.supplierPayment === "CARTAO_AGENCIA" &&
                    (() => {
                      const card = agencyCards.find((c) => c.id === i.supplierCardAccountId);
                      const preview = cardPreview(i, card, g.saleDate);
                      return (
                        <div className="mt-3 rounded-lg border border-brand-100 bg-brand-25 p-3">
                          {agencyCards.length === 0 ? (
                            <p className="text-sm text-amber-800">Nenhum cartão da agência cadastrado. Cadastre em Financeiro › Contas e saldos.</p>
                          ) : (
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                              <Field label="Qual cartão" required error={err(`items.${idx}.supplierCardAccountId`)}>
                                <Select value={i.supplierCardAccountId} onChange={(e) => updateItem(i.uid, { supplierCardAccountId: e.target.value })}>
                                  <option value="">Selecione o cartão…</option>
                                  {agencyCards.map((c) => (
                                    <option key={c.id} value={c.id} disabled={!c.ready}>
                                      {c.name}
                                      {c.ready ? "" : " (falta o dia de fechamento e de vencimento)"}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Parcelas na fatura">
                                <Select
                                  value={String(i.supplierCardInstallments)}
                                  onChange={(e) => {
                                    const n = Number(e.target.value);
                                    if (n < 2) updateItem(i.uid, { supplierCardInstallments: n, cardOld: false, supplierCardStartInstallment: 1, supplierCardFirstBillMonth: "" });
                                    else updateItem(i.uid, { supplierCardInstallments: n, supplierCardStartInstallment: Math.min(i.supplierCardStartInstallment, n) });
                                  }}
                                >
                                  {Array.from({ length: 24 }, (_, k) => k + 1).map((n) => (
                                    <option key={n} value={n}>
                                      {n === 1 ? "1x (à vista)" : `${n}x`}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Field label="Data da compra no cartão" hint="Define em qual fatura entra. Se vazio, usa a data da venda.">
                                <Input type="date" value={i.supplierDueDate} onChange={(e) => updateItem(i.uid, { supplierDueDate: e.target.value })} />
                              </Field>
                              <label className="flex items-center gap-2 self-end pb-2 text-[13px] text-slate-700">
                                <input type="checkbox" checked={!!i.cardOld} onChange={(e) => toggleCardOld(i, e.target.checked)} disabled={i.supplierCardInstallments < 2} />
                                Venda antiga (já tem parcelas pagas)
                              </label>
                              {i.cardOld && i.supplierCardInstallments > 1 && (
                                <>
                                  <Field label="Em que parcela a compra está" error={err(`items.${idx}.supplierCardStartInstallment`)} hint="as anteriores já foram pagas e não entram nas faturas">
                                    <Select value={String(i.supplierCardStartInstallment)} onChange={(e) => updateItem(i.uid, { supplierCardStartInstallment: Number(e.target.value) })}>
                                      {Array.from({ length: i.supplierCardInstallments }, (_, k) => k + 1).map((n) => (
                                        <option key={n} value={n}>
                                          {n}ª de {i.supplierCardInstallments}
                                        </option>
                                      ))}
                                    </Select>
                                  </Field>
                                  <Field label="Fatura em que essa parcela cai" hint="mês da fatura do cartão">
                                    <Input type="month" value={i.supplierCardFirstBillMonth} onChange={(e) => updateItem(i.uid, { supplierCardFirstBillMonth: e.target.value })} />
                                  </Field>
                                </>
                              )}
                            </div>
                          )}
                          {preview && <p className="mt-2 text-xs text-brand-700">{preview}</p>}
                          {i.costCents <= 0 && agencyCards.length > 0 && <p className="mt-2 text-xs text-amber-800">Informe o custo do fornecedor para lançar no cartão.</p>}
                          {i.id && cardAlready.has(i.id) && (
                            <p className="mt-2 text-xs text-amber-800">
                              Este custo já está na fatura do cartão. Se mudar valor, cartão ou parcelas, o sistema ajusta a fatura (desde que ela ainda não tenha sido paga).
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  <details className="group mt-3" open={extras}>
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand-600 [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">+</span>
                      <span className="hidden group-open:inline">−</span> Taxas RAV/DU, over, operadora, localizador, vencimento e receita
                      {rule && i.autoRule && rule.overBps > 0 && <Badge tone="violet" className="ml-1">over automático</Badge>}
                    </summary>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label="Taxa RAV (R$)" hint="cobrada do cliente · receita da agência">
                        <MoneyInput value={i.ravCents} onChange={(v) => updateItem(i.uid, { ravCents: v })} />
                      </Field>
                      <Field label="Taxa DU (R$)" hint="cobrada do cliente · receita da agência">
                        <MoneyInput value={i.duCents} onChange={(v) => updateItem(i.uid, { duCents: v })} />
                      </Field>
                      <Field label="Over / incentivo do fornecedor (R$)" hint={rule && i.autoRule ? `regra do fornecedor: ${formatPercentBps(rule.overBps)}` : "bônus que o fornecedor paga à agência"}>
                        <MoneyInput value={i.overCents} onChange={(v) => updateItem(i.uid, { overCents: v, autoRule: false })} />
                      </Field>
                      {i.commercialModel === "COMISSAO" ? (
                        <Field label="Taxa CC RAV/DU" hint="retida pelo fornecedor (cliente pagou no cartão)" error={err(`items.${idx}.cardFeeCents`)}>
                          <MoneyInput value={i.cardFeeCents} onChange={(v) => updateItem(i.uid, { cardFeeCents: v })} />
                        </Field>
                      ) : (
                        <div className="hidden lg:block" />
                      )}
                      <Field label="Operadora / consolidadora" hint="quem fatura o produto, se diferente do fornecedor">
                        <Select value={i.operatorId} onChange={(e) => updateItem(i.uid, { operatorId: e.target.value })}>
                          <option value="">O próprio fornecedor</option>
                          {(operators.length ? operators : tourSuppliers).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Localizador do item">
                        <Input value={i.locator} onChange={(e) => updateItem(i.uid, { locator: e.target.value })} />
                      </Field>
                      {(i.supplierPayment === "CLIENTE_DIRETO" || i.supplierPayment === "FATURADO") && (
                        <Field
                          label={i.supplierPayment === "CLIENTE_DIRETO" ? "Previsão do repasse da comissão" : "Vencimento do pagamento ao fornecedor"}
                          hint="Se vazio, o sistema sugere pela data da viagem."
                          className="sm:col-span-2"
                        >
                          <Input type="date" value={i.supplierDueDate} onChange={(e) => updateItem(i.uid, { supplierDueDate: e.target.value })} />
                        </Field>
                      )}
                      {i.supplierPayment !== "CLIENTE_DIRETO" && (
                        <Field label="Como contar a receita" hint={COMMERCIAL_MODEL_HELP[i.commercialModel]} className="sm:col-span-2">
                          <Select value={i.commercialModel} onChange={(e) => updateItem(i.uid, { commercialModel: e.target.value as CommercialModel })}>
                            {AGENCY_REVENUE_MODELS.values.map((v) => (
                              <option key={v} value={v}>
                                {AGENCY_REVENUE_MODELS.label(v)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
        </Section>

        <Section icon={Wallet} step={3} title="Valores e comissões" description="Taxa de serviço e desconto do cliente, comissão do vendedor (quanto ele ganha) e do intermediário.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Taxa de serviço da agência (R$)" hint="cobrada do cliente, além dos produtos">
              <MoneyInput value={fees} onChange={setFees} />
            </Field>
            <Field label="Desconto dado ao cliente (R$)" error={err("discountCents")} hint="sai do valor que o cliente paga">
              <MoneyInput value={discount} onChange={setDiscount} />
            </Field>
            <Field label="Comissão do vendedor: como calcular" hint="é o que o vendedor ganha nesta venda">
              <Select
                value={commission.mode}
                onChange={(e) => {
                  const s = sellers.find((x) => x.id === g.sellerId);
                  setCommission(e.target.value === "VALOR" ? { mode: "VALOR", amountCents: totals.sellerCommissionCents } : { mode: "PERCENTUAL", bps: s?.commissionRateBps ?? 1000 });
                }}
              >
                <option value="VALOR">Valor fixo (R$)</option>
                <option value="PERCENTUAL">% sobre o lucro</option>
              </Select>
            </Field>
            {commission.mode === "VALOR" ? (
              <Field label="Comissão do vendedor (R$)">
                <MoneyInput value={commission.amountCents} onChange={(v) => setCommission({ mode: "VALOR", amountCents: v })} />
              </Field>
            ) : (
              <Field label="% do vendedor sobre o lucro" hint={`= ${formatBRL(totals.sellerCommissionCents)} para o vendedor`}>
                <div className="relative">
                  <Input type="number" min={0} max={100} step={0.5} value={commission.bps / 100} onChange={(e) => setCommission({ mode: "PERCENTUAL", bps: Math.round(Number(e.target.value) * 100) })} className="pr-8 text-right" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
                </div>
              </Field>
            )}
            <Field label="Intermediário / parceiro" className="sm:col-span-2" error={err("intermediaryId")} hint={intermediaries.length ? "Freelancer ou parceiro que indicou a venda." : "Cadastre fornecedores na categoria “Intermediário / parceiro”."}>
              <Select value={g.intermediaryId} onChange={(e) => setG({ ...g, intermediaryId: e.target.value })} disabled={!intermediaries.length}>
                <option value="">Sem intermediário</option>
                {intermediaries.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            {g.intermediaryId && (
              <Field label="Comissão do intermediário / parceiro (R$)" hint="o que a agência paga ao parceiro (vira conta a pagar)">
                <MoneyInput value={interComm} onChange={setInterComm} />
              </Field>
            )}
          </div>
        </Section>

        <Section icon={CreditCard} step={4} title="Pagamento do cliente" description={`Valor a receber pela agência: ${formatBRL(totals.clientPayableCents)}`}>
          {totals.clientPayableCents === 0 ? (
            <p className="text-sm text-muted">Nenhum valor a receber pela agência (itens pagos diretamente ao fornecedor).</p>
          ) : (
            <>
              <div className="mb-4 grid gap-3 rounded-xl border border-line bg-slate-50/60 p-4 sm:grid-cols-2 lg:grid-cols-5">
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
                <table className="w-full min-w-[680px] text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-subtle">
                      <th className="pb-2 font-semibold">#</th>
                      <th className="pb-2 font-semibold">Vencimento</th>
                      <th className="pb-2 font-semibold">Forma</th>
                      <th className="pb-2 font-semibold">Pagante</th>
                      <th className="pb-2 text-right font-semibold">Valor</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p, idx) => {
                      const lockedCents = initial.locked[p.key];
                      const set = (patch: Partial<Payment>) => {
                        setPlanTouched(true);
                        setPayments(payments.map((x) => (x.key === p.key ? { ...x, ...patch } : x)));
                      };
                      return (
                        <tr key={p.key} className="border-t border-line">
                          <td className="py-2 pr-2 text-xs text-muted">{idx + 1}</td>
                          <td className="py-2 pr-2">
                            <Input type="date" value={p.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
                          </td>
                          <td className="py-2 pr-2">
                            <Select value={p.method} onChange={(e) => set({ method: e.target.value })}>
                              {PAYMENT_METHODS.values.map((v) => (
                                <option key={v} value={v}>
                                  {PAYMENT_METHODS.label(v)}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="py-2 pr-2">
                            <Select
                              value={p.payerClientId ?? ""}
                              disabled={!!lockedCents}
                              onChange={(e) => {
                                if (e.target.value === "__novo") return setPayerModal(true);
                                set({ payerClientId: e.target.value || null });
                              }}
                            >
                              <option value="">{client ? `${client.name.split(" ")[0]} (cliente)` : "Cliente da venda"}</option>
                              {payerOptions
                                .filter((x) => x.id !== client?.id)
                                .map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.name}
                                  </option>
                                ))}
                              <option value="__novo">+ Outro pagante…</option>
                            </Select>
                          </td>
                          <td className="w-44 py-2 pr-2">
                            <MoneyInput value={p.amountCents} onChange={(v) => set({ amountCents: v })} />
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
                    setPayments([...payments, { key: newKey(), dueDate: last ? addMonths(last.dueDate, 1) : g.saleDate, amountCents: Math.max(diff, 0), method: last?.method ?? "PIX", payerClientId: last?.payerClientId ?? null }]);
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
          <Modal open={payerModal} onClose={() => setPayerModal(false)} title="Adicionar pagante" description="Pessoa ou empresa que paga parte da venda (pode ser diferente do cliente e dos passageiros).">
            <PersonSearch
              autoFocus
              onPick={(c) => {
                setPeople((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]));
                setPlanTouched(true);
                setPayments((list) => list.map((p, i) => (i === list.length - 1 && !initial.locked[p.key] ? { ...p, payerClientId: c.id } : p)));
                setPayerModal(false);
              }}
            />
            <p className="mt-3 text-xs text-muted">O pagante é aplicado à última parcela; ajuste nas demais pela coluna “Pagante”.</p>
          </Modal>
        </Section>

        <Section icon={UserRound} step={5} title="Passageiros e observações" description="Pode ser preenchido depois — fica sinalizado como pendência.">
          <div className="space-y-3">
            {passengers.map((p) => {
              const set = (patch: Partial<Passenger>) => setPassengers(passengers.map((x) => (x.uid === p.uid ? { ...x, ...patch } : x)));
              return (
                <div key={p.uid} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-4 lg:grid-cols-7">
                  <Field label={p.clientId ? "Nome (cadastro vinculado)" : "Nome"} className="sm:col-span-2">
                    <Input value={p.name} onChange={(e) => set({ name: e.target.value })} />
                  </Field>
                  <Field label="CPF, RG ou RNE">
                    <Input value={p.document} onChange={(e) => set({ document: e.target.value })} />
                  </Field>
                  <Field label="Nascimento">
                    <Input type="date" value={p.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />
                  </Field>
                  <Field label="Passaporte (se necessário)">
                    <Input value={p.passportNumber} onChange={(e) => set({ passportNumber: e.target.value })} autoComplete="off" />
                  </Field>
                  <Field label="Validade do passaporte">
                    <Input type="date" value={p.passportExpiry} onChange={(e) => set({ passportExpiry: e.target.value })} />
                  </Field>
                  <div className="flex items-end">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPassengers(passengers.filter((x) => x.uid !== p.uid))}>
                      <Trash2 className="h-4 w-4" /> Remover
                    </Button>
                  </div>
                  {g.excursionId && (
                    <>
                      <Field label="Quarto (rooming list)">
                        <Input value={p.room ?? ""} onChange={(e) => set({ room: e.target.value })} placeholder="Ex.: 101 duplo" />
                      </Field>
                      <Field label="Poltrona">
                        <Input value={p.seat ?? ""} onChange={(e) => set({ seat: e.target.value })} />
                      </Field>
                    </>
                  )}
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setPassengers([...passengers, { uid: newKey(), name: "", document: "", birthDate: "", passportNumber: "", passportExpiry: "" }])}>
                <Plus className="h-4 w-4" /> Adicionar passageiro
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setPaxModal("busca")}>
                <Search className="h-4 w-4" /> Buscar em cadastros
              </Button>
              {client && !passengers.some((p) => p.clientId === client.id) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPassengers([...passengers, { uid: newKey(), name: client.name, document: client.document ?? "", birthDate: "", passportNumber: "", passportExpiry: "", clientId: client.id }])}>
                  Cliente também viaja
                </Button>
              )}
            </div>
            <p className="flex items-center gap-1 text-xs text-muted">
              <Info className="h-3.5 w-3.5" /> Cliente, pagante e passageiro podem ser pessoas diferentes. Para quem tem cadastro, o que ficar em branco (documento, nascimento, passaporte) é completado com o cadastro ao salvar.
            </p>
            <Field label="Observações da venda">
              <Textarea value={g.notes} onChange={(e) => setG({ ...g, notes: e.target.value })} />
            </Field>
          </div>
          <Modal open={!!paxModal} onClose={() => setPaxModal(null)} title="Adicionar passageiro de um cadastro">
            <PersonSearch
              autoFocus
              onPick={(c) => {
                setPassengers((list) => [...list, { uid: newKey(), name: c.name, document: c.document ?? "", birthDate: "", passportNumber: "", passportExpiry: "", clientId: c.id }]);
                setPaxModal(null);
              }}
            />
          </Modal>
        </Section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card className="overflow-hidden">
          <div className="border-b border-line bg-gradient-to-br from-brand-900 to-sidebar px-5 py-4 text-white">
            <p className="text-xs text-blue-100/70">Total vendido</p>
            <p className="font-display text-2xl font-semibold tabular">{formatBRL(totals.grossCents)}</p>
            {g.excursionId && excursion && (
              <p className="mt-1 flex items-center gap-1 text-xs text-blue-100/80">
                <Bus className="h-3.5 w-3.5" /> {excursion.code}
              </p>
            )}
          </div>
          <dl className="space-y-2.5 p-5 text-sm">
            <Row label="A receber do cliente (agência)" value={formatBRL(totals.clientPayableCents)} />
            <Row label="Repasses a fornecedores" value={formatBRL(totals.costCents)} />
            {ravDu > 0 && <Row label="Taxas RAV/DU" value={formatBRL(ravDu)} />}
            {showMargin && over > 0 && <Row label="Over (incentivos)" value={formatBRL(over)} />}
            {showMargin && <Row label="Receita da agência" value={formatBRL(totals.agencyRevenueCents)} strong />}
            <Row label="Comissão do vendedor" value={formatBRL(totals.sellerCommissionCents)} />
            {totals.intermediaryCommissionCents > 0 && <Row label="Comissão do intermediário" value={formatBRL(totals.intermediaryCommissionCents)} />}
            {showMargin && (
              <>
                <div className="my-2 border-t border-dashed border-line" />
                <Row label="Lucro bruto" value={formatBRL(totals.grossProfitCents)} strong tone={totals.grossProfitCents < 0 ? "danger" : "success"} />
                <Row label="Margem" value={formatPercentBps(totals.marginBps)} />
              </>
            )}
          </dl>
        </Card>
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-brand-600" /> Ao confirmar, o sistema prepara
          </h3>
          <ul className="mt-3 space-y-1.5 text-[13px] text-slate-600">
            <li>• {payments.length} parcela(s) em contas a receber</li>
            <li>• contas a pagar aos fornecedores</li>
            {items.some((i) => i.supplierPayment === "CARTAO_AGENCIA") && <li>• compras no cartão da agência já lançadas nas faturas</li>}
            {(over > 0 || items.some((i) => i.commercialModel === "COMISSAO")) && <li>• repasses de comissão/over a receber dos fornecedores</li>}
            <li>• comissão do vendedor{totals.intermediaryCommissionCents > 0 ? " e do intermediário" : ""}</li>
            <li>• reservas, prévia do contrato e eventos de automação</li>
          </ul>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-subtle">Checklist</h4>
          <ul className="mt-2 space-y-1.5">
            {checklist.map((c) => (
              <li key={c.label} className={cn("flex items-center gap-2 text-[13px]", c.ok ? "text-slate-600" : "text-amber-800")}>
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <CircleDashed className="h-4 w-4 text-warning" />}
                {c.label}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Itens pendentes não impedem o rascunho; ficam sinalizados na venda.</p>
        </Card>
      </aside>

      <div className="no-print fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/90 backdrop-blur-md lg:left-[var(--sidebar-w,16rem)]">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-6 lg:px-8">
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
