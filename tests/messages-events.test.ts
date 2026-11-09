/** Varredura diária: viagem concluída e formato do contato do cliente nos eventos. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createSale } from "@/server/services/sales";
import { runScheduledAutomations, clientContact } from "@/server/services/automations";
import { makeCompany, exampleSale } from "./helpers";

describe("varredura diária", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  beforeAll(async () => {
    env = await makeCompany("Varredura");
    await prisma.automationSetting.create({ data: { companyId: env.company.id, key: "viagem_concluida.evento", enabled: true } });
  });

  it("não gera mais eventos de aniversário, check-in ou viagem próxima", async () => {
    await prisma.client.update({ where: { id: env.client.id }, data: { birthDate: "1990-11-07", consentMessaging: true } });
    await createSale(env.admin, exampleSale(env.client.id, env.supplier.id, { tripStart: "2026-11-08", tripEnd: "2026-11-09" }));
    await runScheduledAutomations(env.company.id, "2026-11-07");
    const types = (await prisma.automationEvent.findMany({ where: { companyId: env.company.id }, select: { type: true } })).map((e) => e.type);
    expect(types.filter((t) => ["cliente.aniversario", "viagem.checkin", "viagem.proxima", "pagamento.vencendo"].includes(t))).toEqual([]);
  });

  it("marca a venda como concluída depois do retorno, uma vez só", async () => {
    const r1 = await runScheduledAutomations(env.company.id, "2026-11-10");
    const r2 = await runScheduledAutomations(env.company.id, "2026-11-10");
    expect(r1.concluidas).toBe(1);
    expect(r2.concluidas).toBe(0);
    expect(await prisma.automationEvent.count({ where: { companyId: env.company.id, type: "viagem.concluida" } })).toBe(1);
  });

  it("formata o telefone para o WhatsApp", () => {
    const base = { id: "1", name: "Ana", phone: null, email: null, fredyContactId: null, consentMessaging: false };
    expect(clientContact({ ...base, whatsapp: "+55 (42) 99999-0000" }).whatsapp).toBe("5542999990000");
    expect(clientContact({ ...base, whatsapp: null }).whatsapp).toBeNull();
  });
});
