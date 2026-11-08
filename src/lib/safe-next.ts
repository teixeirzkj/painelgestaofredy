/**
 * Endereço de volta depois do login (?next=). Só caminhos internos: barra "//", "\", espaços e caracteres de controle,
 * que o navegador transforma em outro site (ex.: "/\evil.com" ou "/<TAB>/evil.com" viram https://evil.com).
 */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length > 500) return fallback;
  if (!/^\/(?![/\\])[A-Za-z0-9/_\-?=&.%~:+,@!]*$/.test(next)) return fallback;
  try {
    const u = new URL(next, "http://interno.invalid");
    if (u.host !== "interno.invalid") return fallback;
    return u.pathname + u.search;
  } catch {
    return fallback;
  }
}
