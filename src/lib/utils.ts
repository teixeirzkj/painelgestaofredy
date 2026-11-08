import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

export function formatDocument(doc: string | null | undefined): string {
  const d = onlyDigits(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return doc ?? "";
}

/** Mascara documento sensível (LGPD): ***.456.789-** */
export function maskDocument(doc: string | null | undefined): string {
  const d = onlyDigits(doc);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return formatDocument(d);
  if (!d) return "—";
  return `${"*".repeat(Math.max(0, d.length - 3))}${d.slice(-3)}`;
}

export function maskPassport(p: string | null | undefined): string {
  if (!p) return "—";
  return `${"*".repeat(Math.max(0, p.length - 3))}${p.slice(-3)}`;
}

export function isValidCPF(cpf: string): boolean {
  const d = onlyDigits(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function isValidCNPJ(cnpj: string): boolean {
  const d = onlyDigits(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((acc, wi, i) => acc + Number(d[i]) * wi, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function isValidDocument(doc: string): boolean {
  const d = onlyDigits(doc);
  return d.length === 11 ? isValidCPF(d) : d.length === 14 ? isValidCNPJ(d) : false;
}

export function newKey(): string {
  return globalThis.crypto.randomUUID();
}

export function csvEscape(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // texto que começa com = + - @ vira fórmula no Excel (injeção de fórmula): prefixa com apóstrofo.
  // números (inclusive negativos) continuam números.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return /[";\n\r']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers: string[], rows: unknown[][]): string {
  // separador ";" e BOM para abrir corretamente no Excel em pt-BR
  return "﻿" + [headers, ...rows].map((r) => r.map(csvEscape).join(";")).join("\r\n");
}
