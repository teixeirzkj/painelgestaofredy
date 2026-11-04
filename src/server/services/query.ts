import type { Tx } from "../db";

const isPostgres = (process.env.DATABASE_URL ?? "").startsWith("postgres");

/**
 * Filtro "contém" sem diferenciar maiúsculas. No SQLite o LIKE já é case-insensitive (ASCII);
 * no PostgreSQL é necessário mode: "insensitive".
 */
export function textContains(value: string): { contains: string } {
  return (isPostgres ? { contains: value, mode: "insensitive" } : { contains: value }) as { contains: string };
}

/** Delegado comum a Receivable e Payable (mesma forma nos campos usados na sincronização). */
export type EntryDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  findMany(args: { where: Record<string, unknown> }): Promise<
    { id: string; settledCents: number; amountCents: number; status: string; description: string; notes: string | null; sourceKey: string | null; dueDate: string; invoiceId?: string | null }[]
  >;
};

export function entryDelegate(tx: Tx, kind: "receivable" | "payable"): EntryDelegate {
  return (kind === "receivable" ? tx.receivable : tx.payable) as unknown as EntryDelegate;
}
