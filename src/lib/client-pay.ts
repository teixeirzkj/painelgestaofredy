import { formatBRL } from "./money";

/** Formas com que o cliente paga o fornecedor quando paga direto a ele (informativo: vai para o contrato). */
export const CLIENT_PAY_METHODS = {
  CARTAO_CREDITO: "Cartão de crédito",
  PIX: "PIX",
  PONTOS: "Pontos / milhas",
  BOLETO: "Boleto",
  CARTAO_DEBITO: "Cartão de débito",
  TRANSFERENCIA: "Transferência",
  DINHEIRO: "Dinheiro",
  OUTRO: "Outro",
} as const;
export type ClientPayMethod = keyof typeof CLIENT_PAY_METHODS;
export const CLIENT_PAY_METHOD_VALUES = Object.keys(CLIENT_PAY_METHODS) as [ClientPayMethod, ...ClientPayMethod[]];

/** Formas que podem ser parceladas. */
export const canSplit = (m: string) => m === "CARTAO_CREDITO" || m === "BOLETO" || m === "OUTRO";

export type ClientPay = { method: string; amountCents: number; installments: number; note?: string | null };

export function parseClientPays(json: string | null | undefined): ClientPay[] {
  try {
    const v = JSON.parse(json || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const label = (m: string) => (CLIENT_PAY_METHODS as Record<string, string>)[m] ?? m;

function part(p: ClientPay, withAmount: boolean) {
  const n = canSplit(p.method) ? Math.max(1, p.installments || 1) : 1;
  const times = canSplit(p.method) ? (n > 1 ? ` em ${n}x` : " à vista") : "";
  const amount = withAmount && p.amountCents > 0 ? ` de ${formatBRL(p.amountCents)}` : "";
  const note = p.note?.trim() ? ` (${p.note.trim()})` : "";
  return `${label(p.method)}${amount}${times}${note}`;
}

/**
 * Texto de como o cliente paga o fornecedor: "Cartão de crédito em 10x" ou, com mais de uma forma,
 * "Cartão de crédito de R$ 15.000,00 em 10x + PIX de R$ 5.600,00". Vazio quando não foi informado.
 */
export function clientPayText(list: ClientPay[]) {
  const valid = list.filter((p) => p.method);
  if (!valid.length) return "";
  return valid.map((p) => part(p, valid.length > 1)).join(" + ");
}
