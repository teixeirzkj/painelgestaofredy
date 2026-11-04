/**
 * Conciliação bancária manual (MVP).
 * Importa extratos em CSV padronizado, detecta duplicidade por impressão digital
 * (data + valor + descrição + ocorrência) e permite confirmar a correspondência com
 * baixas já registradas. Nenhuma integração bancária real é feita.
 *
 * Formato CSV aceito (cabeçalho obrigatório, separador ";" ou ","):
 *   data;descricao;valor
 *   05/11/2026;PIX RECEBIDO MARIA;2000,00
 *   06/11/2026;PAGAMENTO OPERADORA;-6500,00
 */
import Papa from "papaparse";
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { parseBrDate, addDays } from "@/lib/dates";
import { parseBRL } from "@/lib/money";
import { newKey } from "@/lib/utils";

export type ParsedLine = { date: string; description: string; amountCents: number; fingerprint: string };

export function parseStatementCSV(text: string): { lines: ParsedLine[]; errors: string[] } {
  const clean = text.replace(/^﻿/, "");
  const delimiter = clean.split("\n")[0].includes(";") ? ";" : ",";
  const res = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: true, delimiter, transformHeader: (h) => h.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") });
  const errors: string[] = [];
  const lines: ParsedLine[] = [];
  const seen = new Map<string, number>();
  const fields = res.meta.fields ?? [];
  for (const f of ["data", "descricao", "valor"]) if (!fields.includes(f)) errors.push(`Coluna obrigatória ausente: ${f}`);
  if (errors.length) return { lines, errors };
  res.data.forEach((row, idx) => {
    const date = parseBrDate(row.data ?? "");
    const amount = parseBRL(row.valor ?? "");
    const description = (row.descricao ?? "").trim().slice(0, 200);
    if (!date || amount === null || amount === 0) {
      errors.push(`Linha ${idx + 2}: data ou valor inválido.`);
      return;
    }
    const base = `${date}|${amount}|${description.toUpperCase()}`;
    const occurrence = (seen.get(base) ?? 0) + 1; // lançamentos idênticos no mesmo arquivo são distintos
    seen.set(base, occurrence);
    lines.push({ date, description, amountCents: amount, fingerprint: createHash("sha256").update(`${base}|${occurrence}`).digest("hex").slice(0, 40) });
  });
  return { lines, errors };
}

export async function importStatement(ctx: Ctx, accountId: string, csv: string) {
  assertCan(ctx, "finance.manage");
  const account = await prisma.financialAccount.findFirst({ where: { id: accountId, companyId: ctx.companyId } });
  if (!account) throw new AppError("Conta inválida.");
  const { lines, errors } = parseStatementCSV(csv);
  if (!lines.length) throw new AppError(errors[0] ?? "Nenhuma linha válida no arquivo.");
  const batch = newKey();
  let imported = 0;
  let duplicates = 0;
  await prisma.$transaction(async (tx) => {
    for (const l of lines) {
      const exists = await tx.bankStatementLine.findUnique({ where: { companyId_accountId_fingerprint: { companyId: ctx.companyId, accountId, fingerprint: l.fingerprint } } });
      if (exists) {
        duplicates++;
        continue;
      }
      await tx.bankStatementLine.create({ data: { ...l, companyId: ctx.companyId, accountId, importBatch: batch, status: "PENDENTE" } });
      imported++;
    }
    await audit(tx, ctx, "extrato.importado", "FinancialAccount", accountId, { imported, duplicates, errors: errors.length });
  });
  return { imported, duplicates, errors };
}

export async function listStatementLines(ctx: Ctx, accountId: string, status = "PENDENTE") {
  assertCan(ctx, "finance.view");
  const lines = await prisma.bankStatementLine.findMany({
    where: { companyId: ctx.companyId, accountId, ...(status ? { status } : {}) },
    orderBy: { date: "desc" },
    take: 200,
    include: { settlement: { include: { receivable: { select: { description: true } }, payable: { select: { description: true } } } } },
  });
  // Sugestões: baixas da mesma conta, mesmo valor e sentido, data ±5 dias, ainda não conciliadas.
  const pending = lines.filter((l) => l.status === "PENDENTE");
  const suggestions: Record<string, { id: string; date: string; amountCents: number; description: string }[]> = {};
  if (pending.length) {
    const reconciledIds = (await prisma.bankStatementLine.findMany({ where: { companyId: ctx.companyId, settlementId: { not: null } }, select: { settlementId: true } })).map((l) => l.settlementId!);
    const candidates = await prisma.settlement.findMany({
      where: { companyId: ctx.companyId, accountId, reversedAt: null, id: { notIn: reconciledIds } },
      include: { receivable: { select: { description: true } }, payable: { select: { description: true } } },
      orderBy: { date: "desc" },
      take: 500,
    });
    for (const l of pending) {
      const kind = l.amountCents > 0 ? "RECEBIMENTO" : "PAGAMENTO";
      suggestions[l.id] = candidates
        .filter((c) => c.kind === kind && c.amountCents === Math.abs(l.amountCents) && c.date >= addDays(l.date, -5) && c.date <= addDays(l.date, 5))
        .slice(0, 5)
        .map((c) => ({ id: c.id, date: c.date, amountCents: c.amountCents, description: c.receivable?.description ?? c.payable?.description ?? "" }));
    }
  }
  return { lines, suggestions };
}

export async function matchStatementLine(ctx: Ctx, lineId: string, settlementId: string) {
  assertCan(ctx, "finance.manage");
  await prisma.$transaction(async (tx) => {
    const line = await tx.bankStatementLine.findFirst({ where: { id: lineId, companyId: ctx.companyId } });
    if (!line) throw new AppError("Linha não encontrada.", "NOT_FOUND");
    if (line.status !== "PENDENTE") throw new AppError("Linha já tratada.");
    const s = await tx.settlement.findFirst({ where: { id: settlementId, companyId: ctx.companyId, accountId: line.accountId, reversedAt: null } });
    if (!s) throw new AppError("Baixa inválida para esta conta.");
    if (s.amountCents !== Math.abs(line.amountCents)) throw new AppError("Os valores não correspondem.");
    const already = await tx.bankStatementLine.findFirst({ where: { settlementId } });
    if (already) throw new AppError("Esta baixa já foi conciliada com outra linha.");
    await tx.bankStatementLine.update({ where: { id: lineId }, data: { status: "CONCILIADO", settlementId } });
    await audit(tx, ctx, "extrato.conciliado", "BankStatementLine", lineId, { settlementId });
  });
}

export async function setStatementLineStatus(ctx: Ctx, lineId: string, status: "IGNORADO" | "PENDENTE") {
  assertCan(ctx, "finance.manage");
  const line = await prisma.bankStatementLine.findFirst({ where: { id: lineId, companyId: ctx.companyId } });
  if (!line) throw new AppError("Linha não encontrada.", "NOT_FOUND");
  await prisma.bankStatementLine.update({ where: { id: lineId }, data: { status, settlementId: null } });
}
