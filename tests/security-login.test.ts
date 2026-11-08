/** Teste de invasão do login: força bruta por e-mail+IP, por e-mail e por IP, e desbloqueio depois de entrar certo. */
import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { loginBlocked, MAX_PER_EMAIL, MAX_PER_EMAIL_IP, MAX_PER_IP } from "@/server/services/login-guard";

const uniq = () => randomBytes(5).toString("hex");
const fail = (email: string, ip: string, n: number) => prisma.accessLog.createMany({ data: Array.from({ length: n }, () => ({ email, ip, type: "FALHA" })) });

describe("login: proteção contra força bruta", () => {
  it(`trava o atacante (mesmo IP) depois de ${MAX_PER_EMAIL_IP} senhas erradas, sem trancar o dono da conta em outro lugar`, async () => {
    const email = `alvo-${uniq()}@teste.com`;
    await fail(email, "10.0.0.1", MAX_PER_EMAIL_IP - 1);
    expect(await loginBlocked(email, "10.0.0.1")).toBe(false);
    await fail(email, "10.0.0.1", 1);
    expect(await loginBlocked(email, "10.0.0.1")).toBe(true);
    expect(await loginBlocked(email, "200.1.2.3")).toBe(false); // o dono, de outro IP, ainda entra
  });

  it(`trava o e-mail para todos depois de ${MAX_PER_EMAIL} erros vindos de vários IPs (ataque distribuído)`, async () => {
    const email = `distribuido-${uniq()}@teste.com`;
    for (let i = 0; i < MAX_PER_EMAIL; i++) await fail(email, `10.3.${i}.1`, 1);
    expect(await loginBlocked(email, "200.9.9.9")).toBe(true);
  });

  it(`trava o IP que testa muitos e-mails diferentes (${MAX_PER_IP} erros)`, async () => {
    const ip = `172.16.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    for (let i = 0; i < MAX_PER_IP; i++) await fail(`varredura-${uniq()}@teste.com`, ip, 1);
    expect(await loginBlocked(`outro-${uniq()}@teste.com`, ip)).toBe(true);
    expect(await loginBlocked(`outro-${uniq()}@teste.com`, "192.168.250.1")).toBe(false);
  });

  it("erros antigos (mais de 15 min) não contam e login certo zera a contagem do e-mail", async () => {
    const email = `antigo-${uniq()}@teste.com`;
    const old = new Date(Date.now() - 20 * 60_000);
    await prisma.accessLog.createMany({ data: Array.from({ length: MAX_PER_EMAIL + 2 }, () => ({ email, ip: "10.1.1.1", type: "FALHA", createdAt: old })) });
    expect(await loginBlocked(email, "10.1.1.1")).toBe(false);

    const email2 = `zera-${uniq()}@teste.com`;
    await prisma.accessLog.createMany({ data: Array.from({ length: MAX_PER_EMAIL_IP - 1 }, (_, i) => ({ email: email2, ip: "10.2.2.2", type: "FALHA", createdAt: new Date(Date.now() - (10 - i) * 1000) })) });
    await prisma.accessLog.create({ data: { email: email2, ip: "10.2.2.2", type: "LOGIN" } });
    await fail(email2, "10.2.2.2", 1);
    expect(await loginBlocked(email2, "10.2.2.2")).toBe(false);
  });
});
