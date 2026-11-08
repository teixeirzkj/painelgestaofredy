/**
 * Proteção do login contra força bruta.
 * As tentativas erradas ficam no próprio banco (AccessLog, tipo FALHA), então o limite vale para todas as instâncias
 * do servidor (na Vercel cada requisição pode cair numa instância diferente; um contador em memória não protege).
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db";

const WINDOW_MS = 15 * 60_000;
/** erros no mesmo e-mail vindos do mesmo IP antes de travar esse IP para esse e-mail (desde o último login certo) */
export const MAX_PER_EMAIL_IP = 5;
/** erros no mesmo e-mail de qualquer lugar: trava geral (alto, para um atacante não conseguir trancar a conta de alguém) */
export const MAX_PER_EMAIL = 20;
/** erros vindos do mesmo IP (qualquer e-mail) antes de travar: segura quem testa muitos e-mails */
export const MAX_PER_IP = 30;

export async function loginBlocked(email: string, ip: string | null) {
  const since = new Date(Date.now() - WINDOW_MS);
  const lastOk = await prisma.accessLog.findFirst({ where: { email, type: "LOGIN", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const from = lastOk?.createdAt ?? since;
  const [byEmail, byEmailIp, byIp] = await Promise.all([
    prisma.accessLog.count({ where: { email, type: "FALHA", createdAt: { gte: from } } }),
    ip ? prisma.accessLog.count({ where: { email, ip, type: "FALHA", createdAt: { gte: from } } }) : Promise.resolve(0),
    ip ? prisma.accessLog.count({ where: { ip, type: "FALHA", createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  return byEmail >= MAX_PER_EMAIL || byEmailIp >= MAX_PER_EMAIL_IP || byIp >= MAX_PER_IP;
}

let dummy: string | null = null;
/**
 * Quando o e-mail não existe, compara a senha com um hash qualquer para a resposta levar o mesmo tempo
 * (sem isso, dá para descobrir quais e-mails têm conta medindo a demora).
 */
export async function burnPasswordCheck(password: string) {
  dummy ??= await bcrypt.hash("senha-que-nao-existe-" + Math.random(), 10);
  await bcrypt.compare(password, dummy);
}

/** IP de quem chamou (na Vercel, o primeiro valor de x-forwarded-for é o do cliente). */
export function clientIp(h: Headers) {
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "").slice(0, 60) || null;
}
