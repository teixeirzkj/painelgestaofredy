/** Venda por print: a resposta da IA é simulada; testa a conversão para o formulário e os vínculos com o cadastro. */
import { beforeAll, describe, expect, it, vi } from "vitest";

const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = class extends APIError {};
    static RateLimitError = class extends APIError {};
    static BadRequestError = class extends APIError {};
    beta = { messages: { parse } };
  }
  return { default: Anthropic };
});

import { prisma } from "@/server/db";
import { extractSaleFromFile } from "@/server/services/ai-extract";
import { makeCompany } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;
const png = { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mimeType: "image/png", name: "reserva.png" };

function output(over: Record<string, unknown> = {}) {
  return {
    stop_reason: "end_turn",
    parsed_output: {
      isTravelBooking: true,
      client: { name: "Maria Cliente", document: "529.982.247-25", email: null, phone: "(42) 99999-0000" },
      destination: "Gramado - RS",
      tripStart: "2027-02-10",
      tripEnd: "2027-02-05",
      locator: "ABC123",
      passengers: [
        { name: "Maria Cliente", document: "529.982.247-25", birthDate: "1990-04-02" },
        { name: "João", document: null, birthDate: "data inválida" },
      ],
      items: [{ productType: "PACOTE", description: "Pacote Gramado 5 noites", supplierName: "operadora x", priceReais: 5400.5, costReais: 4300, locator: "ABC123" }],
      totalReais: 5400.5,
      paymentNotes: "10x no cartão",
      notes: null,
      ...over,
    },
  };
}

describe("venda por print com IA", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeCompany("IA");
  });

  it("sem a chave da IA, avisa que a leitura não está ativada", async () => {
    const old = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(extractSaleFromFile(env.seller, png)).rejects.toThrow(/ANTHROPIC_API_KEY/);
    process.env.ANTHROPIC_API_KEY = old;
  });

  it("converte valores em centavos, vincula cliente pelo CPF e fornecedor pelo nome, e descarta datas inválidas", async () => {
    process.env.ANTHROPIC_API_KEY = "teste";
    parse.mockResolvedValueOnce(output());
    const d = await extractSaleFromFile(env.seller, png);
    expect(d.client.match?.id).toBe(env.client.id);
    expect(d.items[0]).toMatchObject({ supplierId: env.supplier.id, priceCents: 540050, costCents: 430000, productType: "PACOTE" });
    expect(d.tripStart).toBe("2027-02-10");
    expect(d.tripEnd).toBeNull(); // volta antes da ida não é aceita
    expect(d.passengers[1].birthDate).toBe("");
    expect(d.totalCents).toBe(540050);
    // o pedido usa o modelo atual, com saída estruturada
    const req = parse.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.output_config.format).toBeTruthy();
    expect(req.messages[0].content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png" } });
  });

  it("só total, sem produtos: cria um item com o total; documento que não é viagem é recusado", async () => {
    parse.mockResolvedValueOnce(output({ items: [], client: { name: "Desconhecido", document: null, email: null, phone: null } }));
    const d = await extractSaleFromFile(env.seller, png);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].priceCents).toBe(540050);
    expect(d.client.match).toBeNull();
    parse.mockResolvedValueOnce(output({ isTravelBooking: false }));
    await expect(extractSaleFromFile(env.seller, png)).rejects.toThrow(/não parece uma reserva/);
  });

  it("não aceita arquivo de outro tipo nem usuário sem permissão de venda", async () => {
    await expect(extractSaleFromFile(env.seller, { ...png, mimeType: "text/plain" })).rejects.toThrow(/imagem/);
    await prisma.rolePermission.deleteMany({ where: { companyId: env.company.id } });
    await expect(extractSaleFromFile({ ...env.seller, permissions: new Set() } as never, png)).rejects.toThrow();
  });
});
