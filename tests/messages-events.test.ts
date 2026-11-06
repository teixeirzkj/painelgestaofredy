/** Eventos para mensagens automáticas pelo n8n: aniversário, check-in e feedback, com contato do cliente. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createSale } from "@/server/services/sales";
import { runScheduledAutomations, clientContact } from "@/server/services/automations";
import { makeCompany, exampleSale } from "./helpers";

describe("eventos de mensagens automáticas", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  beforeAll(async () => {
    env = await makeCompany("Mensagens");
    await prisma.automationSetting.createMany({
      data: ["cliente_aniversario.evento", "checkin_lembrete.evento", "viagem_concluida.evento"].map((key) => ({ companyId: env.company.id, key, enabled: true })),
    });
    await prisma.client.update({ where: { id: env.client.id }, data: { birthDate: "1990-11-07", whatsapp: "(42) 99999-0000", email: "maria@x.com", consentMessaging: true } });
    await prisma.client.create({ data: { companyId: env.company.id, name: "Bissexto Silva", birthDate: "2000-02-29" } });
  });

  it("aniversário: um evento por cliente por ano, com WhatsApp no formato 55 e consentimento", async () => {
    await runScheduledAutomations(env.company.id, "2026-11-07");
    await runScheduledAutomations(env.company.id, "2026-11-07"); // repetido no mesmo dia: não duplica
    const evs = await prisma.automationEvent.findMany({ where: { companyId: env.company.id, type: "cliente.aniversario" } });
    expect(evs).toHaveLength(1);
    const data = JSON.parse(evs[0].payloadJson).data;
    expect(data).toMatchObject({ age: 36, messagingAllowed: true, client: { name: "Maria Cliente", firstName: "Maria", whatsapp: "5542999990000", email: "maria@x.com" } });
  });

  it("aniversário em 29/02 é lembrado em 28/02 nos anos não bissextos", async () => {
    await runScheduledAutomations(env.company.id, "2027-02-28");
    const evs = await prisma.automationEvent.findMany({ where: { companyId: env.company.id, type: "cliente.aniversario", idempotencyKey: { contains: ":2027" } } });
    expect(evs).toHaveLength(1);
  });

  it("check-in na véspera do embarque e feedback depois do retorno", async () => {
    const s = await createSale(env.admin, exampleSale(env.client.id, env.supplier.id, { tripStart: "2026-12-10", tripEnd: "2026-12-15" }));
    await runScheduledAutomations(env.company.id, "2026-12-08");
    expect(await prisma.automationEvent.count({ where: { companyId: env.company.id, type: "viagem.checkin" } })).toBe(0);
    await runScheduledAutomations(env.company.id, "2026-12-09");
    const checkin = await prisma.automationEvent.findFirstOrThrow({ where: { companyId: env.company.id, type: "viagem.checkin" } });
    expect(JSON.parse(checkin.payloadJson).data).toMatchObject({ saleCode: s.code, tripStart: "2026-12-10", client: { whatsapp: "5542999990000" } });
    await runScheduledAutomations(env.company.id, "2026-12-16");
    expect(await prisma.automationEvent.count({ where: { companyId: env.company.id, type: "viagem.concluida" } })).toBe(1);
  });

  it("formata o telefone para o WhatsApp", () => {
    const base = { id: "1", name: "Ana", phone: null, email: null, fredyContactId: null, consentMessaging: false };
    expect(clientContact({ ...base, whatsapp: "+55 (42) 99999-0000" }).whatsapp).toBe("5542999990000");
    expect(clientContact({ ...base, whatsapp: null }).whatsapp).toBeNull();
  });
});
