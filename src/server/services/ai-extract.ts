/**
 * Leitura de reserva por IA (Claude): o vendedor envia o print ou o PDF da reserva e o sistema devolve os dados
 * para PRÉ-PREENCHER o formulário de venda. Nada é gravado aqui: o vendedor revisa, ajusta a forma de pagamento
 * e confirma. Requer a variável ANTHROPIC_API_KEY; sem ela a função avisa que a leitura não está ativada.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { prisma } from "../db";
import { assertCan, type Ctx } from "../context";
import { AppError } from "../errors";
import { PRODUCT_TYPES } from "@/lib/constants";
import { isIsoDate } from "@/lib/dates";
import { onlyDigits } from "@/lib/utils";

export const AI_EXTRACT_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

const MODEL = "claude-opus-5-5";

const ExtractionSchema = z.object({
  isTravelBooking: z.boolean().describe("true se o documento é uma reserva, orçamento, voucher, bilhete ou confirmação de viagem"),
  client: z.object({
    name: z.string().nullable().describe("nome do titular/comprador"),
    document: z.string().nullable().describe("CPF ou CNPJ do titular, como aparece"),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  destination: z.string().nullable().describe("destino principal, ex.: 'Gramado - RS' ou 'Lisboa, Portugal'"),
  tripStart: z.string().nullable().describe("data de ida/início no formato AAAA-MM-DD"),
  tripEnd: z.string().nullable().describe("data de volta/fim no formato AAAA-MM-DD"),
  locator: z.string().nullable().describe("localizador/código da reserva principal"),
  passengers: z.array(
    z.object({
      name: z.string(),
      document: z.string().nullable().describe("CPF ou passaporte"),
      birthDate: z.string().nullable().describe("AAAA-MM-DD"),
    }),
  ),
  items: z.array(
    z.object({
      productType: z.enum(PRODUCT_TYPES.values).describe("tipo do produto"),
      description: z.string().describe("descrição curta: trecho do voo, hotel e noites, nome do pacote..."),
      supplierName: z.string().nullable().describe("companhia aérea, operadora, consolidadora ou hotel"),
      priceReais: z.number().nullable().describe("valor de venda ao cliente deste produto, em reais (ex.: 1234.56)"),
      costReais: z.number().nullable().describe("valor de custo/tarifa líquida, se aparecer separado, em reais"),
      locator: z.string().nullable(),
    }),
  ),
  totalReais: z.number().nullable().describe("valor total cobrado do cliente, em reais"),
  paymentNotes: z.string().nullable().describe("forma de pagamento e parcelas como aparecem no documento"),
  notes: z.string().nullable().describe("observações relevantes (bagagem, regime de alimentação, políticas)"),
});

export type SaleExtraction = {
  client: { name: string | null; document: string | null; email: string | null; phone: string | null; match: { id: string; name: string; document: string | null; whatsapp: string | null } | null };
  destination: string | null;
  tripStart: string | null;
  tripEnd: string | null;
  locator: string | null;
  passengers: { name: string; document: string; birthDate: string }[];
  items: { productType: string; description: string; supplierId: string | null; supplierName: string | null; priceCents: number; costCents: number; locator: string }[];
  totalCents: number | null;
  paymentNotes: string | null;
  notes: string | null;
};

const SYSTEM = `Você lê documentos de reservas de viagem de agências brasileiras (prints de sistemas de operadoras e consolidadoras, e-mails de confirmação, vouchers, bilhetes, orçamentos em PDF) e extrai os dados para o cadastro de uma venda.

Regras:
- Extraia somente o que está no documento. Campo ausente ou ilegível = null. Nunca invente nomes, documentos, datas ou valores.
- Datas sempre em AAAA-MM-DD. Valores em reais como número (1.234,56 → 1234.56).
- Um item por produto vendido (cada voo/trecho agrupado por bilhete, cada hotel, cada pacote, seguro, transfer, passeio). Se só existir um valor total, devolva um único item com esse valor.
- Se o documento mostrar tarifa e taxas separadas, priceReais é o valor total cobrado do cliente pelo item.
- Passageiros: todos os nomes listados como passageiros/hóspedes.
- Se o documento não for de viagem, marque isTravelBooking = false.`;

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new AppError("A leitura por IA ainda não está ativada: falta configurar a chave ANTHROPIC_API_KEY nas variáveis do sistema.");
  return new Anthropic();
}

const isoOrEmpty = (v: string | null) => (v && isIsoDate(v) ? v : "");
const toCents = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : 0);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function extractSaleFromFile(ctx: Ctx, file: { bytes: Buffer; mimeType: string; name: string }): Promise<SaleExtraction> {
  assertCan(ctx, "sales.create");
  if (file.bytes.length === 0) throw new AppError("Arquivo vazio.");
  if (file.bytes.length > AI_EXTRACT_MAX_BYTES) throw new AppError("Arquivo acima de 8 MB. Envie um print ou PDF menor.");
  const isPdf = file.mimeType === "application/pdf";
  if (!isPdf && !IMAGE_TYPES.includes(file.mimeType as ImageType)) throw new AppError("Envie uma imagem (PNG, JPG, WEBP) ou um PDF.");
  const data = file.bytes.toString("base64");
  const source: Anthropic.Beta.BetaContentBlockParam = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: file.mimeType as ImageType, data } };

  let parsed: z.infer<typeof ExtractionSchema> | null = null;
  try {
    const res = await client().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(ExtractionSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: [source, { type: "text", text: "Extraia os dados desta reserva para cadastrar a venda." }] }],
    });
    if (res.stop_reason === "refusal") throw new AppError("A IA não conseguiu ler este documento. Preencha a venda manualmente.");
    parsed = res.parsed_output ?? null;
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AppError("A chave da IA (ANTHROPIC_API_KEY) foi recusada. Confira a chave nas variáveis do sistema.");
    if (e instanceof Anthropic.RateLimitError) throw new AppError("Muitas leituras ao mesmo tempo. Tente de novo em instantes.");
    if (e instanceof Anthropic.BadRequestError) throw new AppError("O arquivo não pôde ser lido pela IA (formato ou tamanho). Tente um print mais nítido.");
    if (e instanceof Anthropic.APIError) throw new AppError("O serviço de IA está indisponível agora. Tente de novo em alguns minutos.");
    throw e;
  }
  if (!parsed) throw new AppError("A IA não devolveu dados legíveis. Tente outro print ou preencha manualmente.");
  if (!parsed.isTravelBooking) throw new AppError("O arquivo não parece uma reserva de viagem.");

  // Cliente já cadastrado: por CPF/CNPJ, depois e-mail, depois nome exato.
  const doc = onlyDigits(parsed.client.document ?? "");
  const email = parsed.client.email?.trim().toLowerCase() || null;
  const select = { id: true, name: true, document: true, whatsapp: true } as const;
  const match =
    (doc.length === 11 || doc.length === 14 ? await prisma.client.findFirst({ where: { companyId: ctx.companyId, document: doc, archivedAt: null }, select }) : null) ??
    (email ? await prisma.client.findFirst({ where: { companyId: ctx.companyId, email, archivedAt: null }, select }) : null) ??
    (parsed.client.name ? await prisma.client.findFirst({ where: { companyId: ctx.companyId, name: parsed.client.name.trim(), archivedAt: null }, select }) : null);

  // Fornecedor pelo nome (contém / está contido), sem criar cadastro novo.
  const suppliers = await prisma.supplier.findMany({ where: { companyId: ctx.companyId, archivedAt: null }, select: { id: true, name: true } });
  const findSupplier = (name: string | null) => {
    if (!name) return null;
    const n = norm(name);
    if (!n) return null;
    return suppliers.find((s) => norm(s.name) === n) ?? suppliers.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name))) ?? null;
  };

  let items = parsed.items.map((i) => {
    const sup = findSupplier(i.supplierName);
    return {
      productType: i.productType,
      description: i.description.slice(0, 300),
      supplierId: sup?.id ?? null,
      supplierName: i.supplierName,
      priceCents: toCents(i.priceReais),
      costCents: toCents(i.costReais),
      locator: (i.locator ?? "").slice(0, 60),
    };
  });
  const totalCents = toCents(parsed.totalReais) || null;
  if (items.length === 0 && totalCents) items = [{ productType: "PACOTE", description: parsed.destination ?? "Viagem", supplierId: null, supplierName: null, priceCents: totalCents, costCents: 0, locator: parsed.locator ?? "" }];
  // Só um item sem valor, mas com total: o total vai para o item.
  if (items.length === 1 && items[0].priceCents === 0 && totalCents) items[0].priceCents = totalCents;

  const tripStart = isoOrEmpty(parsed.tripStart);
  const tripEnd = isoOrEmpty(parsed.tripEnd);
  return {
    client: { name: parsed.client.name, document: doc || null, email, phone: onlyDigits(parsed.client.phone ?? "") || null, match },
    destination: parsed.destination?.slice(0, 120) ?? null,
    tripStart: tripStart || null,
    tripEnd: tripEnd && (!tripStart || tripEnd >= tripStart) ? tripEnd : null,
    locator: parsed.locator?.slice(0, 60) ?? null,
    passengers: parsed.passengers.slice(0, 60).map((p) => ({ name: p.name.slice(0, 150), document: onlyDigits(p.document ?? "") || (p.document ?? ""), birthDate: isoOrEmpty(p.birthDate) })),
    items: items.slice(0, 30),
    totalCents,
    paymentNotes: parsed.paymentNotes,
    notes: parsed.notes,
  };
}
