import { z } from "zod";
import {
  COMMERCIAL_MODELS,
  PAYMENT_METHODS,
  PRODUCT_TYPES,
  PAYABLE_CATEGORIES,
  RECEIVABLE_CATEGORIES,
  SUPPLIER_CATEGORIES,
  ACCOUNT_TYPES,
  ROLES,
  PERSON_TYPES,
  EXCURSION_STATUS,
  REFUND_KINDS,
  SUPPLIER_PAYMENTS,
  SUPPLIER_CASH_METHODS,
} from "@/lib/constants";
import { normalizeSupplierPayment } from "@/lib/finance";
import { isIsoDate } from "@/lib/dates";
import { isValidDocument, onlyDigits } from "@/lib/utils";
import { normalizeDocCode, normalizeGender } from "@/lib/client-identity";

export const isoDate = z.string().refine(isIsoDate, "Data inválida.");
const optDate = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isIsoDate(v), "Data inválida.");
const optText = (max = 500) =>
  z
    .string()
    .max(max, `Máximo de ${max} caracteres.`)
    .optional()
    .nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null));
/** Passaporte / RNE: maiúsculas, sem espaços. */
const docCode = (max = 20) => optText(max + 10).transform((v) => normalizeDocCode(v)).refine((v) => v === null || v.length <= max, `Máximo de ${max} caracteres.`);
const cents = z.number().int("Valor inválido.").min(0, "Valor não pode ser negativo.").max(2_000_000_000, "Valor muito alto.");
const id = z.string().min(1).max(40);
/** Mês de fatura do cartão: "AAAA-MM". */
const billMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Escolha o mês da fatura.");

export const saleItemSchema = z.object({
  id: id.optional().nullable(),
  productType: z.enum(PRODUCT_TYPES.values),
  description: optText(300),
  supplierId: id.optional().nullable().transform((v) => v || null),
  commercialModel: z.enum(COMMERCIAL_MODELS.values),
  priceCents: cents,
  costCents: cents.default(0),
  supplierCommissionCents: cents.default(0),
  supplierDueDate: optDate,
  locator: optText(60),
  operatorId: id.optional().nullable().transform((v) => v || null),
  ravCents: cents.default(0),
  duCents: cents.default(0),
  overCents: cents.default(0),
  cardFeeCents: cents.default(0),
  // Como a agência paga o fornecedor (sem o campo, sai do modelo comercial: ver normalizeSupplierPayment)
  supplierPayment: z.enum(SUPPLIER_PAYMENTS.values).optional().nullable(),
  supplierPayMethod: z.enum(SUPPLIER_CASH_METHODS).optional().nullable().or(z.literal("")).transform((v) => v || null),
  supplierCardAccountId: id.optional().nullable().or(z.literal("")).transform((v) => v || null),
  supplierCardInstallments: z.number().int().min(1, "Parcelas inválidas.").max(24, "No máximo 24 parcelas.").default(1),
  supplierCardStartInstallment: z.number().int().min(1, "Parcela inválida.").max(24, "Parcela inválida.").default(1),
  supplierCardFirstBillMonth: billMonth.optional().nullable().or(z.literal("")).transform((v) => v || null),
})
  .transform((i) => normalizeSupplierPayment(i))
  .superRefine((i, c) => {
    if (i.supplierPayment === "A_VISTA" && !i.supplierPayMethod)
      c.addIssue({ code: "custom", path: ["supplierPayMethod"], message: "Escolha como a agência pagou (pix, transferência, dinheiro ou débito)." });
    if (i.supplierPayment === "CARTAO_AGENCIA" && i.supplierCardStartInstallment > i.supplierCardInstallments)
      c.addIssue({ code: "custom", path: ["supplierCardStartInstallment"], message: "A parcela inicial não pode ser maior que o número de parcelas." });
  });

export const paymentPlanSchema = z.object({
  key: z.string().min(1).max(60),
  dueDate: isoDate,
  amountCents: cents.refine((v) => v > 0, "Parcela com valor zero."),
  method: z.enum(PAYMENT_METHODS.values),
  description: optText(120),
  payerClientId: id.optional().nullable().transform((v) => v || null), // pagante diferente do cliente
});

export const passengerSchema = z.object({
  name: z.string().trim().min(2, "Nome do passageiro obrigatório.").max(120),
  document: optText(20),
  birthDate: optDate,
  passportNumber: docCode(20),
  passportExpiry: optDate,
  clientId: id.optional().nullable().transform((v) => v || null),
  room: optText(40),
  seat: optText(20),
});

export const saleInputSchema = z.object({
  saleDate: isoDate,
  clientId: id,
  sellerId: id.optional().nullable(),
  mainProductType: z.enum(PRODUCT_TYPES.values).optional().nullable(),
  destination: optText(120),
  tripStart: optDate,
  tripEnd: optDate,
  passengerCount: z.number().int().min(1).max(500).default(1),
  locator: optText(60),
  notes: optText(2000),
  feesCents: cents.default(0),
  discountCents: cents.default(0),
  tripId: id.optional().nullable().transform((v) => v || null),
  excursionId: id.optional().nullable().transform((v) => v || null),
  intermediaryId: id.optional().nullable().transform((v) => v || null),
  intermediaryCommissionCents: cents.default(0),
  commission: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("VALOR"), amountCents: cents }),
    z.object({ mode: z.literal("PERCENTUAL"), bps: z.number().int().min(0).max(10000) }),
  ]),
  items: z.array(saleItemSchema).min(1, "Inclua ao menos um produto.").max(30),
  payments: z.array(paymentPlanSchema).max(60),
  passengers: z.array(passengerSchema).max(50).default([]),
  confirm: z.boolean().default(false),
}).refine((s) => !s.tripStart || !s.tripEnd || s.tripEnd >= s.tripStart, {
  message: "A data de retorno deve ser posterior à data de início.",
  path: ["tripEnd"],
});
export type SaleInput = z.input<typeof saleInputSchema>;
export type SaleParsed = z.output<typeof saleInputSchema>;

const docField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? onlyDigits(v) : null))
  .refine((v) => v === null || v === "" || isValidDocument(v), "CPF/CNPJ inválido.")
  .transform((v) => (v ? v : null));

export const clientSchema = z.object({
  personType: z.enum(PERSON_TYPES.values).default("PF"),
  name: z.string().trim().min(3, "Informe o nome completo ou a razão social.").max(150),
  tradeName: optText(150),
  document: docField,
  rg: optText(20),
  passportNumber: docCode(20),
  passportExpiry: optDate,
  foreigner: z.boolean().default(false),
  nationality: optText(60),
  rne: docCode(20),
  gender: z.string().optional().nullable().transform((v) => normalizeGender(v)),
  specialNeeds: optText(500),
  phone: optText(20),
  whatsapp: optText(20),
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido."),
  birthDate: optDate,
  zipCode: optText(9),
  street: optText(150),
  number: optText(20),
  complement: optText(80),
  district: optText(80),
  city: optText(80),
  state: optText(2),
  notes: optText(2000),
  consentMessaging: z.boolean().default(false),
}).refine((c) => !c.document || (c.personType === "PJ" ? c.document.length === 14 : c.document.length === 11), {
  message: "Use CPF para pessoa física e CNPJ para pessoa jurídica.",
  path: ["document"],
}).transform((c) => (c.personType === "PJ" ? { ...c, foreigner: false, nationality: null, rne: null, gender: null } : c));
export type ClientInput = z.input<typeof clientSchema>;

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome ou razão social.").max(150),
  document: docField,
  contactName: optText(100),
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "E-mail inválido."),
  phone: optText(20),
  category: z.enum(SUPPLIER_CATEGORIES.values),
  billingCycle: z.enum(["AVULSO", "DECENDIAL", "QUINZENAL", "MENSAL"]).default("AVULSO"),
  bankInfo: optText(300),
  pixKey: optText(120),
  notes: optText(2000),
});
export type SupplierInput = z.input<typeof supplierSchema>;

export const manualReceivableSchema = z.object({
  description: z.string().trim().min(2, "Informe a descrição.").max(200),
  clientId: id.optional().nullable().transform((v) => v || null),
  saleId: id.optional().nullable().transform((v) => v || null),
  category: z.enum(RECEIVABLE_CATEGORIES.values).default("OUTRAS_RECEITAS"),
  amountCents: cents.refine((v) => v > 0, "Informe o valor."),
  firstDueDate: isoDate,
  installments: z.number().int().min(1).max(48).default(1),
  method: z.enum(PAYMENT_METHODS.values).optional().nullable(),
  costCenterId: id.optional().nullable().transform((v) => v || null),
  notes: optText(1000),
});

export const manualPayableSchema = z.object({
  description: z.string().trim().min(2, "Informe a descrição.").max(200),
  supplierId: id.optional().nullable().transform((v) => v || null),
  saleId: id.optional().nullable().transform((v) => v || null),
  category: z.string().trim().min(1).max(40),
  amountCents: cents.refine((v) => v > 0, "Informe o valor."),
  firstDueDate: isoDate,
  installments: z.number().int().min(1).max(48).default(1),
  recurringMonths: z.number().int().min(1).max(36).default(1), // >1 = recorrente (repete o valor cheio)
  method: z.enum(PAYMENT_METHODS.values).optional().nullable(),
  costCenterId: id.optional().nullable().transform((v) => v || null),
  notes: optText(1000),
  /** Compra já feita no cartão da agência: a conta nasce paga e o valor vai para as faturas. */
  card: z
    .object({
      accountId: id,
      installments: z.number().int().min(1).max(24).default(1),
      startInstallment: z.number().int().min(1).max(24).default(1),
      firstBillMonth: billMonth.optional().nullable().transform((v) => v || null),
    })
    .refine((c) => c.startInstallment <= c.installments, { message: "A parcela inicial não pode ser maior que o número de parcelas.", path: ["startInstallment"] })
    .optional()
    .nullable(),
});

/** Ligar a um cartão um lançamento antigo feito à mão com a categoria "Fatura do cartão". */
export const linkToCardSchema = z.object({
  accountId: id,
  billMonth,
  category: z.string().trim().min(1, "Escolha a categoria da despesa.").max(40),
});

export const entryEditSchema = z.object({
  description: z.string().trim().min(2).max(200),
  amountCents: cents.refine((v) => v > 0, "Informe o valor."),
  dueDate: isoDate,
  category: z.string().min(1),
  method: z.enum(PAYMENT_METHODS.values).optional().nullable(),
  costCenterId: id.optional().nullable().transform((v) => v || null),
  notes: optText(1000),
});

export const settlementSchema = z.object({
  date: isoDate,
  amountCents: cents.refine((v) => v > 0, "Informe o valor movimentado."),
  interestCents: cents.default(0),
  discountCents: cents.default(0),
  accountId: id,
  method: z.enum(PAYMENT_METHODS.values).optional().nullable(),
  notes: optText(500),
  cardInstallments: z.number().int().min(1).max(24).default(1),
  /** Novo valor total da conta neste mês (só para lançamentos feitos à mão). */
  newTotalCents: cents.optional().nullable().transform((v) => (v ? v : null)),
  /** Cartão da agência: fatura da 1ª parcela lançada (vazio = pela data) e parcela em que a compra está. */
  cardFirstBillMonth: billMonth.optional().nullable().transform((v) => v || null),
  cardStartInstallment: z.number().int().min(1).max(24).default(1),
}).refine((d) => d.cardStartInstallment <= d.cardInstallments, { message: "A parcela inicial não pode ser maior que o número de parcelas.", path: ["cardStartInstallment"] });
export type SettlementInput = z.input<typeof settlementSchema>;

export const accountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(ACCOUNT_TYPES.values),
  bankName: optText(80),
  initialBalanceCents: z.number().int().min(-2_000_000_000).max(2_000_000_000).default(0),
  closingDay: z.number().int().min(1).max(31).nullable().optional(),
  dueDay: z.number().int().min(1).max(31).nullable().optional(),
}).refine((a) => a.type !== "CARTAO_CREDITO" || (a.closingDay && a.dueDay), { message: "Informe o dia de fechamento e o dia de vencimento do cartão.", path: ["closingDay"] });

export const transferSchema = z
  .object({
    fromAccountId: id,
    toAccountId: id,
    amountCents: cents.refine((v) => v > 0, "Informe o valor."),
    date: isoDate,
    description: optText(200),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, { message: "Escolha contas diferentes.", path: ["toAccountId"] });

export const userSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email("E-mail inválido."),
  role: z.enum(ROLES.values),
  password: z.string().min(8, "A senha deve ter ao menos 8 caracteres.").max(100).optional().nullable(),
  commissionRateBps: z.number().int().min(0).max(10000).default(0),
  active: z.boolean().default(true),
});

export const tripSchema = z.object({
  clientId: id,
  title: z.string().trim().min(3, "Dê um nome à viagem.").max(120),
  destination: optText(120),
  notes: optText(2000),
});

export const excursionSchema = z
  .object({
    name: z.string().trim().min(3, "Informe o nome da excursão.").max(120),
    destination: z.string().trim().min(2, "Informe o destino.").max(120),
    startDate: isoDate,
    endDate: isoDate,
    seats: z.number().int().min(1, "Informe as vagas.").max(2000),
    pricePerSeatCents: cents,
    status: z.enum(EXCURSION_STATUS.values).default("PLANEJADA"),
    notes: optText(2000),
  })
  .refine((e) => e.endDate >= e.startDate, { message: "O retorno deve ser posterior à saída.", path: ["endDate"] });

export const excursionCostSchema = z.object({
  description: z.string().trim().min(2).max(200),
  supplierId: id.optional().nullable().transform((v) => v || null),
  amountCents: cents.refine((v) => v > 0, "Informe o valor."),
  dueDate: isoDate,
});

export const invoiceSchema = z.object({
  supplierId: id,
  number: z.string().trim().min(1, "Informe o número da fatura.").max(60),
  issueDate: isoDate,
  dueDate: isoDate,
  declaredCents: cents.refine((v) => v > 0, "Informe o valor da fatura."),
  notes: optText(1000),
});

export const invoicePaymentSchema = z.object({
  date: isoDate,
  accountId: id,
  method: z.enum(PAYMENT_METHODS.values).optional().nullable(),
  notes: optText(500),
});

export const costCenterSchema = z.object({ name: z.string().trim().min(2).max(80), active: z.boolean().default(true) });

export const commissionRuleSchema = z
  .object({
    supplierId: id.optional().nullable().transform((v) => v || null),
    productType: z.enum(PRODUCT_TYPES.values).optional().nullable().transform((v) => v || null),
    description: optText(80),
    commissionBps: z.number().int().min(0).max(10000),
    overBps: z.number().int().min(0).max(10000),
    active: z.boolean().default(true),
  })
  .refine((r) => r.supplierId || r.productType, { message: "Informe o fornecedor, o produto ou ambos.", path: ["supplierId"] });

export const refundSchema = z.object({
  kind: z.enum(REFUND_KINDS.values),
  amountCents: cents.refine((v) => v > 0, "Informe o valor."),
  dueDate: isoDate,
  supplierId: id.optional().nullable().transform((v) => v || null),
  description: optText(200),
  requestKey: z.string().min(6).max(60), // idempotência: o mesmo envio não gera dois lançamentos
});
