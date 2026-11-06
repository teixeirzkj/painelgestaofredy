/** Agência nova: modelos de contrato sugeridos destravam os contratos "não gerados". */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createSale } from "@/server/services/sales";
import { createSuggestedTemplates } from "@/server/services/contracts";
import { makeCompany, exampleSale } from "./helpers";

describe("modelos de contrato sugeridos", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  beforeAll(async () => {
    env = await makeCompany("Modelos");
  });

  it("cria os 5 modelos, atualiza o contrato parado e não duplica", async () => {
    const s = await createSale(env.admin, exampleSale(env.client.id, env.supplier.id));
    expect((await prisma.contract.findFirstOrThrow({ where: { saleId: s.id } })).status).toBe("NAO_GERADO");
    const r = await createSuggestedTemplates(env.admin);
    expect(r).toEqual({ created: 5, refreshed: 1 });
    const c = await prisma.contract.findFirstOrThrow({ where: { saleId: s.id } });
    expect(c.status).toBe("EM_PREPARACAO");
    expect(c.content).toContain(env.client.name);
    await expect(createSuggestedTemplates(env.admin)).rejects.toThrow(/já tem modelos/);
    expect(await prisma.contractTemplate.count({ where: { companyId: env.company.id } })).toBe(5);
  });

  it("vendedor não pode criar modelos", async () => {
    await expect(createSuggestedTemplates(env.seller)).rejects.toThrow();
  });
});
