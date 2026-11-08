/**
 * Bloqueia chamadas do servidor para a rede interna (SSRF) quando a URL vem do usuário (ex.: webhook da agência).
 * Exige https na porta padrão, resolve o DNS e recusa endereços privados, loopback, link-local, CGNAT e multicast.
 */
import { lookup } from "node:dns/promises";
import net from "node:net";
import { AppError } from "./errors";

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff");
}

export async function assertPublicHttpsUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError("URL inválida.");
  }
  if (u.protocol !== "https:") throw new AppError("Use uma URL https://.");
  if (u.username || u.password) throw new AppError("A URL não pode ter usuário e senha.");
  if (u.port && u.port !== "443") throw new AppError("Use a porta padrão do https (443).");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new AppError("Endereço interno não é permitido.");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [] as { address: string }[]);
  if (!addrs.length) throw new AppError("Não foi possível encontrar esse endereço.");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new AppError("Endereço interno não é permitido.");
}
