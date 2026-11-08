/**
 * Criptografia de segredos de integração guardados no banco (ex.: token da API do Frédy).
 * AES-256-GCM com chave derivada de INTEGRATIONS_KEY (se definida) ou AUTH_SECRET.
 * Trocar essa variável invalida os tokens salvos: a agência precisa colar o token de novo.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

function key() {
  const base = process.env.INTEGRATIONS_KEY || process.env.AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("INTEGRATIONS_KEY/AUTH_SECRET ausente ou muito curto.");
  return createHash("sha256").update(`fredy-gestao:integracoes:${base}`).digest();
}

/** Compara segredos em tempo constante, sem erro quando os tamanhos (em bytes) são diferentes. */
export function safeEqual(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const h = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(h(given), h(expected));
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, enc] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Segredo em formato inválido.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
