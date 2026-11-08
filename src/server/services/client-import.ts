/**
 * Importação de clientes (planilha CSV e Monde). Regra comum: nunca apaga nem sobrescreve o que
 * já foi digitado na gestão; só completa campos vazios. Encontra o cliente existente pelo id do
 * Monde, pelo CPF/CNPJ, pelo passaporte ou pelo e-mail.
 */
import Papa from "papaparse";
import { prisma, type Tx } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { audit } from "../audit";
import { isValidDocument, onlyDigits } from "@/lib/utils";
import { isBrazilianNationality, normalizeDocCode, normalizeGender } from "@/lib/client-identity";

export type ImportedClient = {
  name: string;
  document?: string | null;
  rg?: string | null;
  birthDate?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  zipCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  passportNumber?: string | null;
  passportExpiry?: string | null;
  notes?: string | null;
  tradeName?: string | null;
  gender?: string | null;
  nationality?: string | null;
  rne?: string | null;
};
export type ImportOutcome = "criado" | "atualizado" | "sem_mudanca";

const clean = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Aceita 31/12/1990, 31-12-1990, 1990-12-31 (e ISO com hora). */
export function parseDate(v: unknown): string | null {
  const s = clean(v, 40);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}
function valid(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 1900 || y > 2100 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function normalize(c: ImportedClient) {
  const digits = onlyDigits(c.document);
  const document = digits && isValidDocument(digits) ? digits : null;
  const email = clean(c.email, 150)?.toLowerCase() ?? null;
  const state = clean(c.state, 2)?.toUpperCase() ?? null;
  const nationality = clean(c.nationality, 60);
  const rne = normalizeDocCode(clean(c.rne, 30))?.slice(0, 20) ?? null;
  const pj = document?.length === 14;
  // estrangeiro: tem RNE ou nacionalidade que não é brasileira (o Monde não informa nenhum dos dois)
  const foreigner = !pj && (!!rne || (!!nationality && !isBrazilianNationality(nationality)));
  return {
    data: {
      name: clean(c.name, 150) ?? "",
      personType: document?.length === 14 ? "PJ" : "PF",
      tradeName: clean(c.tradeName, 150),
      document,
      rg: clean(c.rg, 20),
      birthDate: parseDate(c.birthDate),
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      phone: clean(c.phone, 20),
      whatsapp: clean(c.whatsapp, 20),
      zipCode: clean(c.zipCode, 9),
      street: clean(c.street, 150),
      number: clean(c.number, 20),
      complement: clean(c.complement, 80),
      district: clean(c.district, 80),
      city: clean(c.city, 80),
      state: state && /^[A-Z]{2}$/.test(state) ? state : null,
      passportNumber: normalizeDocCode(clean(c.passportNumber, 30))?.slice(0, 20) ?? null,
      passportExpiry: parseDate(c.passportExpiry),
      notes: clean(c.notes, 2000),
      gender: pj ? null : normalizeGender(c.gender),
      nationality: pj ? null : nationality,
      rne: pj ? null : rne,
      foreigner,
    },
    invalidDocument: !!digits && !document,
  };
}

/** Cria ou completa um cliente. Campos já preenchidos na gestão nunca são sobrescritos. */
export async function upsertImportedClient(tx: Tx, ctx: Ctx, input: ImportedClient, opts: { mondeId?: string } = {}): Promise<{ outcome: ImportOutcome; id: string; warning?: string }> {
  const { data, invalidDocument } = normalize(input);
  if (data.name.length < 3) throw new AppError("nome ausente ou muito curto");
  const or = [
    ...(opts.mondeId ? [{ mondeId: opts.mondeId }] : []),
    ...(data.document ? [{ document: data.document }] : []),
    ...(data.passportNumber ? [{ passportNumber: data.passportNumber }] : []),
    ...(data.email ? [{ email: data.email }] : []),
  ];
  // sem CPF nem e-mail: procura pelo nome exato (evita duplicar ao reimportar a mesma planilha)
  if (!or.length) or.push({ name: data.name, document: null } as never);
  const existing = await tx.client.findFirst({ where: { companyId: ctx.companyId, OR: or }, orderBy: { createdAt: "asc" } });
  const warning = invalidDocument ? "CPF/CNPJ inválido foi ignorado" : undefined;
  if (existing) {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === "personType" || k === "foreigner" || v == null || v === "") continue;
      const cur = (existing as Record<string, unknown>)[k];
      if (cur == null || cur === "") patch[k] = v;
    }
    // estrangeiro só é marcado (nunca desmarcado) pela importação
    if (data.foreigner && !existing.foreigner && existing.personType !== "PJ") patch.foreigner = true;
    // CPF de outro cliente não pode ser reaproveitado (único por agência)
    if (patch.document && (await tx.client.findFirst({ where: { companyId: ctx.companyId, document: patch.document as string, id: { not: existing.id } } }))) delete patch.document;
    // passaporte que já é de outro cliente também não é copiado
    if (patch.passportNumber && (await tx.client.findFirst({ where: { companyId: ctx.companyId, passportNumber: patch.passportNumber as string, id: { not: existing.id } } }))) {
      delete patch.passportNumber;
      delete patch.passportExpiry;
    }
    if (opts.mondeId && !existing.mondeId) patch.mondeId = opts.mondeId;
    if (!Object.keys(patch).length) return { outcome: "sem_mudanca", id: existing.id, warning };
    await tx.client.update({ where: { id: existing.id }, data: patch });
    return { outcome: "atualizado", id: existing.id, warning };
  }
  const c = await tx.client.create({ data: { ...data, companyId: ctx.companyId, ownerId: ctx.userId, mondeId: opts.mondeId ?? null } });
  return { outcome: "criado", id: c.id, warning };
}

// ------------------------------ Planilha CSV ------------------------------

const ALIASES: Record<keyof ImportedClient, string[]> = {
  name: ["nome", "nome completo", "cliente", "razao social", "nome/razao social"],
  tradeName: ["nome fantasia", "fantasia"],
  document: ["cpf", "cnpj", "cpf/cnpj", "cpf / cnpj", "documento", "cpf_cnpj"],
  rg: ["rg", "identidade"],
  birthDate: ["nascimento", "data de nascimento", "data nascimento", "aniversario", "dt nascimento"],
  email: ["email", "e-mail", "e mail"],
  phone: ["telefone", "fone", "telefone fixo", "tel"],
  whatsapp: ["whatsapp", "celular", "telefone celular", "cel", "whats"],
  zipCode: ["cep"],
  street: ["endereco", "rua", "logradouro"],
  number: ["numero", "nº", "n"],
  complement: ["complemento"],
  district: ["bairro"],
  city: ["cidade", "municipio"],
  state: ["estado", "uf"],
  passportNumber: ["passaporte", "numero do passaporte", "n passaporte"],
  passportExpiry: ["validade do passaporte", "validade passaporte", "vencimento passaporte"],
  notes: ["observacoes", "observacao", "obs"],
  gender: ["sexo", "genero"],
  nationality: ["nacionalidade", "pais de origem"],
  rne: ["rne", "rnm", "crnm", "rne/rnm", "rne / rnm", "rne rnm"],
};
const norm = (h: string) => h.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " ").trim();

export { CLIENT_CSV_TEMPLATE } from "@/lib/client-csv";

export function parseClientCsv(text: string) {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy", delimiter: "" });
  const [header, ...rows] = parsed.data;
  if (!header?.length) throw new AppError("Planilha vazia.");
  const map = new Map<number, keyof ImportedClient>();
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [field, names] of Object.entries(ALIASES)) if (names.includes(n) && ![...map.values()].includes(field as keyof ImportedClient)) map.set(i, field as keyof ImportedClient);
  });
  if (![...map.values()].includes("name")) throw new AppError('A planilha precisa de uma coluna "nome". Baixe o modelo para ver as colunas aceitas.');
  return {
    columns: [...map.entries()].map(([i, f]) => ({ header: header[i], field: f })),
    rows: rows.map((r) => {
      const o: ImportedClient = { name: "" };
      for (const [i, f] of map) (o as Record<string, string>)[f] = r[i] ?? "";
      return o;
    }),
  };
}

export async function importClientsCsv(ctx: Ctx, text: string) {
  assertCan(ctx, "clients.manage");
  if (text.length > 5_000_000) throw new AppError("Planilha acima de 5 MB. Divida em partes.");
  const { rows } = parseClientCsv(text);
  if (rows.length > 5000) throw new AppError("Máximo de 5.000 clientes por planilha. Divida em partes.");
  const result = { criados: 0, atualizados: 0, semMudanca: 0, erros: [] as { linha: number; motivo: string }[], avisos: [] as { linha: number; motivo: string }[] };
  for (const [i, row] of rows.entries()) {
    const linha = i + 2;
    if (!Object.values(row).some((v) => v && String(v).trim())) continue;
    try {
      const r = await prisma.$transaction((tx) => upsertImportedClient(tx, ctx, row));
      if (r.outcome === "criado") result.criados++;
      else if (r.outcome === "atualizado") result.atualizados++;
      else result.semMudanca++;
      if (r.warning) result.avisos.push({ linha, motivo: r.warning });
    } catch (e) {
      result.erros.push({ linha, motivo: e instanceof AppError ? e.message : "erro ao gravar" });
    }
  }
  await prisma.$transaction((tx) => audit(tx, ctx, "clientes.importados", "Client", null, { origem: "planilha", criados: result.criados, atualizados: result.atualizados, erros: result.erros.length }));
  return result;
}
