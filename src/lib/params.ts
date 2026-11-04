export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
export type Params<T extends string = "id"> = Promise<Record<T, string>>;

export function str(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim().slice(0, 200) : undefined;
}

export function int(sp: Record<string, string | string[] | undefined>, key: string, fallback = 1): number {
  const n = Number(str(sp, key));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Monta uma URL mantendo os filtros atuais e alterando alguns parâmetros. */
export function withParams(base: string, sp: Record<string, string | string[] | undefined>, changes: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s) p.set(k, s);
  }
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === "") p.delete(k);
    else p.set(k, String(v));
  }
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}
