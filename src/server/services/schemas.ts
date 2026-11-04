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
} from "@/lib/constants";
import { isIsoDate } from "@/lib/dates";
import { isValidDocument, onlyDigits } from "@/lib/utils";

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
const cents = z.number().int("Valor inválido.").min(0, "Valor não pode ser negativo.").max(2_000_000_000, "Valor muito alto.");
const id = z.string().min(1).max(40);

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
});

export const paymentPlanSchema = z.object({
  key: z.string().min(1).max(60),
  dueDate: isoDate,
  amountCents: cents.refine((v) => v > 0, "Parcela com valor zero."),
  method: z.enum(PAYMENT_METHODS.values),
  description: optText(120),
});

export const passengerSchema = z.object({
  name: z.string().trim().min(2, "Nome do passageiro obrigatório.").max(120),
  document: optText(20),
  birthDate: optDate,
  passportNumber: optText(20),
  passportExpiry: optDate,
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
  name: z.string().trim().min(3, "Informe o nome completo.").max(150),
  document: docField,
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
});
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
  notes: optText(1000),
});

export const manualPayableSchema = z.object({
  description: z.string().trim().min(2, "Informe a descrição.").max(200),
  supplierId: id.optional().nullable().transform((v) => v || null),
  saleId: id.optional().nullable().transform((v) => v || null),
  category: z.enum(PAYABLE_CATEGORIES.values),
  amountCents: cents.refine((v) => v > 0, "Informe o valor."),
  firstDueDate: isoDate,
  installments: z.number().int().min(1).max(48).default(1),
  recurringMonths: z.number().int().min(1).max(36).default(1), // >1 = recorrente (repete o valor cheio)
  method: z.enum(PAYMENT_METHODS.values).optional().nullable(),
  notes: optText(1000),
});

export const entryEditSchema = z.object({
  description: z.string().trim().min(2).max(200),
  amountCents: cents.refine((v) => v > 0, "Informe o valor."),
  dueDate: isoDate,
  category: z.string().min(1),
  method: z.enum(PAYMENT_METHODS.values).optional().nullable(),
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
});
export type SettlementInput = z.input<typeof settlementSchema>;

export const accountSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(ACCOUNT_TYPES.values),
  bankName: optText(80),
  initialBalanceCents: z.number().int().min(-2_000_000_000).max(2_000_000_000).default(0),
});

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
