import { formatDocument, maskDocument, maskPassport, onlyDigits } from "@/lib/utils";

/**
 * Identificação do cliente para contrato, venda rápida e pendências.
 * Brasileiro: CPF/CNPJ. Estrangeiro: o passaporte ou o RNE/RNM substituem o CPF.
 * Funções puras (sem banco), usadas no servidor e na tela.
 */
export type IdentityInput = {
  personType?: string | null;
  document: string | null;
  foreigner?: boolean | null;
  passportNumber?: string | null;
  rne?: string | null;
  nationality?: string | null;
};

/** O cliente tem um documento que serve para o contrato? */
export function hasClientDocument(c: IdentityInput): boolean {
  return !!c.document || (!!c.foreigner && (!!c.passportNumber || !!c.rne));
}

/** O que falta, em palavras simples: "CPF/CNPJ" ou "passaporte ou RNE". */
export function missingDocLabel(c: Pick<IdentityInput, "foreigner">): string {
  return c.foreigner ? "passaporte ou RNE" : "CPF/CNPJ";
}

/**
 * Texto do documento: "CPF 529.982.247-25", "CNPJ ...",
 * ou, para estrangeiro sem CPF, "Passaporte nº AAB123456 (Argentina) · RNE/RNM nº V1234567".
 * Com mask: true, os números saem mascarados (para telas e listas).
 */
export function clientIdentity(c: IdentityInput, { mask }: { mask: boolean }): string | null {
  if (c.document) {
    const kind = onlyDigits(c.document).length === 14 ? "CNPJ" : "CPF";
    return `${kind} ${mask ? maskDocument(c.document) : formatDocument(c.document)}`;
  }
  if (!c.foreigner) return null;
  const parts: string[] = [];
  if (c.passportNumber) {
    const nat = c.nationality ? ` (${c.nationality})` : "";
    parts.push(`Passaporte nº ${mask ? maskPassport(c.passportNumber) : c.passportNumber}${nat}`);
  }
  if (c.rne) parts.push(`RNE/RNM nº ${mask ? maskPassport(c.rne) : c.rne}`);
  return parts.length ? parts.join(" · ") : null;
}

function plain(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** Aceita F/M, feminino/masculino, female/male. Qualquer outra coisa vira "não informado" (null). */
export function normalizeGender(v: unknown): "F" | "M" | null {
  const s = plain(v);
  if (["f", "feminino", "female", "mulher"].includes(s)) return "F";
  if (["m", "masculino", "male", "homem"].includes(s)) return "M";
  return null;
}

/** "Brasil", "brasileira", "brasileiro"... */
export function isBrazilianNationality(v: string | null | undefined): boolean {
  return /^brasil/.test(plain(v));
}

/** Passaporte e RNE: maiúsculas e sem espaços. */
export function normalizeDocCode(v: string | null | undefined): string | null {
  const s = (v ?? "").replace(/\s+/g, "").toUpperCase();
  return s ? s : null;
}

/** Linha curta para cabeçalhos: CPF/CNPJ formatado (como sempre foi) ou, para estrangeiro, passaporte/RNE mascarados. */
export function clientDocHint(c: IdentityInput): string | null {
  return c.document ? formatDocument(c.document) : clientIdentity(c, { mask: true });
}
