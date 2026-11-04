// Utilitários monetários. Todos os valores trafegam como inteiros em centavos.

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatBRL(cents: number | null | undefined): string {
  return brl.format((cents ?? 0) / 100);
}

export function formatBRLCompact(cents: number): string {
  return brlCompact.format(cents / 100);
}

/** Converte texto digitado ("1.234,56", "1234.56", "R$ 10") em centavos. Retorna null se inválido. */
export function parseBRL(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  let s = input.replace(/[R$\s]/g, "").trim();
  if (!s) return null;
  const negative = s.startsWith("-");
  s = s.replace(/^-/, "");
  if (s.includes(",")) {
    // padrão brasileiro: ponto como milhar, vírgula decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) {
    // "1.234.567" ou "8.000": pontos como separador de milhar (padrão brasileiro)
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [int, dec = ""] = s.split(".");
  const cents = Number(int) * 100 + Number((dec + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Valor em centavos para texto editável "1234,56". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  return `${neg ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Divide um total em n parcelas inteiras; a diferença de arredondamento vai para a primeira parcela. */
export function splitInstallments(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const rest = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => (i === 0 ? base + rest : base));
}

/** Percentual em basis points (1% = 100 bps) aplicado sobre centavos, arredondado. */
export function applyBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10000);
}

export function ratioBps(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part * 10000) / whole);
}

export function formatPercentBps(bps: number): string {
  return `${(bps / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
