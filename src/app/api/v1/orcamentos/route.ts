import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Prisma } from "@/server/db";
import { companyFromApiKey } from "@/server/services/settings";
import { loadContext, today } from "@/server/context";
import { createSale } from "@/server/services/sales";
import { audit } from "@/server/audit";
import { COMMERCIAL_MODELS, PRODUCT_TYPES } from "@/lib/constants";
import { isValidDocument, onlyDigits } from "@/lib/utils";
import { isIsoDate } from "@/lib/dates";

/**
 * Entrada de ORÇAMENTOS vindos de sistemas de atendimento (ex.: CRM Frédy, n8n, formulário do site).
 * É a API do próprio Frédy Gestão — não presume nada sobre endpoints do CRM.
 *
 * POST /api/v1/orcamentos     Authorization: Bearer <chave da agência>
 * {
 *   "externalRef": "crm-123",                     // obrigatório; mesma referência = mesmo orçamento (idempotente)
 *   "client": { "name": "...", "document": "CPF/CNPJ", "email": "...", "whatsapp": "...", "fredyContactId": "..." },
 *   "sellerEmail": "vendedor@agencia",            // opcional; padrão: primeiro administrador ativo
 *   "destination": "...", "tripStart": "YYYY-MM-DD", "tripEnd": "YYYY-MM-DD", "passengerCount": 2, "notes": "...",
 *   "items": [{ "productType": "PACOTE", "description": "...", "priceCents": 800000, "costCents": 650000, "commercialModel": "INTERMEDIACAO" }]
 * }
 * Resposta: 201 { saleId, code, created: true } ou 200 { ..., created: false } quando a referência já existe.
 * O orçamento entra como RASCUNHO: nada vai para o financeiro até a agência confirmar a venda.
 */
const date = z.string().refine(isIsoDate, "Data inválida (use AAAA-MM-DD).").optional().nullable();
const bodySchema = z.object({
  externalRef: z.string().trim().min(1).max(80),
  client: z.object({
    name: z.string().trim().min(3).max(150),
    document: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    whatsapp: z.string().max(20).optional().nullable(),
    fredyContactId: z.string().max(80).optional().nullable(),
  }),
  sellerEmail: z.string().email().optional().nullable(),
  destination: z.string().max(120).optional().nullable(),
  tripStart: date,
  tripEnd: date,
  passengerCount: z.number().int().min(1).max(500).default(1),
  notes: z.string().max(2000).optional().nullable(),
  items: z
    .array(
      z.object({
        productType: z.enum(PRODUCT_TYPES.values),
        description: z.string().max(300).optional().nullable(),
        priceCents: z.number().int().min(1),
        costCents: z.number().int().min(0).default(0),
        commercialModel: z.enum(COMMERCIAL_MODELS.values).default("INTERMEDIACAO"),
      }),
    )
    .min(1)
    .max(30),
});

export async function POST(req: Request) {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const company = await companyFromApiKey(key || null);
  if (!company) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Payload inválido.", issues: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) }, { status: 400 });
  const b = parsed.data;

  const existing = await prisma.sale.findFirst({ where: { companyId: company.id, externalRef: b.externalRef }, select: { id: true, code: true } });
  if (existing) return NextResponse.json({ saleId: existing.id, code: existing.code, created: false });

  const seller =
    (b.sellerEmail && (await prisma.user.findFirst({ where: { companyId: company.id, email: b.sellerEmail.toLowerCase(), active: true } }))) ||
    (await prisma.user.findFirst({ where: { companyId: company.id, role: "ADMIN", active: true }, orderBy: { createdAt: "asc" } }));
  if (!seller) return NextResponse.json({ error: "Nenhum usuário ativo para receber o orçamento." }, { status: 422 });
  const ctx = await loadContext(seller.id);
  if (!ctx) return NextResponse.json({ error: "Usuário inválido." }, { status: 422 });

  // Cliente: vínculo pelo id do CRM, depois por CPF/CNPJ, depois por e-mail; senão cria.
  const doc = onlyDigits(b.client.document ?? "");
  const validDoc = doc && isValidDocument(doc) ? doc : null;
  let client =
    (b.client.fredyContactId && (await prisma.client.findFirst({ where: { companyId: company.id, fredyContactId: b.client.fredyContactId } }))) ||
    (validDoc && (await prisma.client.findFirst({ where: { companyId: company.id, document: validDoc } }))) ||
    (b.client.email && (await prisma.client.findFirst({ where: { companyId: company.id, email: b.client.email.toLowerCase() } }))) ||
    null;
  if (!client) {
    client = await prisma.client.create({
      data: {
        companyId: company.id,
        name: b.client.name,
        personType: validDoc?.length === 14 ? "PJ" : "PF",
        document: validDoc,
        email: b.client.email?.toLowerCase() ?? null,
        whatsapp: b.client.whatsapp ?? null,
        fredyContactId: b.client.fredyContactId ?? null,
        ownerId: seller.id,
      },
    });
  } else if (b.client.fredyContactId && !client.fredyContactId) {
    client = await prisma.client.update({ where: { id: client.id }, data: { fredyContactId: b.client.fredyContactId } });
  }

  try {
    const sale = await createSale(
      ctx,
      {
        saleDate: today(ctx),
        clientId: client.id,
        sellerId: seller.id,
        destination: b.destination ?? null,
        tripStart: b.tripStart ?? null,
        tripEnd: b.tripEnd ?? null,
        passengerCount: b.passengerCount,
        notes: [`Orçamento recebido por integração (ref. ${b.externalRef}).`, b.notes].filter(Boolean).join("\n"),
        commission: { mode: "VALOR", amountCents: 0 },
        items: b.items.map((i) => ({ ...i, supplierCommissionCents: 0 })),
        payments: [],
        passengers: [],
        confirm: false,
      },
      { origin: "API", externalRef: b.externalRef },
    );
    await prisma.$transaction((tx) => audit(tx, ctx, "orcamento.recebido_api", "Sale", sale.id, { externalRef: b.externalRef }));
    return NextResponse.json({ saleId: sale.id, code: sale.code, created: true }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await prisma.sale.findFirst({ where: { companyId: company.id, externalRef: b.externalRef }, select: { id: true, code: true } });
      if (again) return NextResponse.json({ saleId: again.id, code: again.code, created: false });
    }
    const msg = e instanceof Error && e.name === "AppError" ? e.message : "Não foi possível registrar o orçamento.";
    if (!(e instanceof Error && e.name === "AppError")) console.error(e);
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
