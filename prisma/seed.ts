/**
 * Dados de DEMONSTRAÇÃO (fictícios). Todos os registros pertencem a empresas marcadas
 * com isDemo = true e são criados pelos próprios serviços da aplicação, garantindo que
 * vendas, parcelas, contas a pagar, comissões e baixas sigam as mesmas regras do uso real.
 *
 * Uso: npm run db:seed   (não executa se já houver empresa de demonstração)
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db";
import { loadContext, type Ctx } from "../src/server/context";
import { createSale, cancelSale } from "../src/server/services/sales";
import { createManualPayable, settleEntry, createTransfer } from "../src/server/services/finance";
import { todayIn, addDays, addMonths, startOfMonth } from "../src/lib/dates";
import { splitInstallments } from "../src/lib/money";

const TZ = "America/Sao_Paulo";
const TODAY = todayIn(TZ);
const PASSWORD = "demo1234";

// PRNG determinístico para dados reprodutíveis
let seed = 20261104;
function rnd() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => Math.floor(a + rnd() * (b - a + 1));
const round = (cents: number, to = 1000) => Math.round(cents / to) * to;

function cpf(): string {
  const n = Array.from({ length: 9 }, () => between(0, 9));
  const dv = (arr: number[]) => {
    const s = arr.reduce((acc, d, i) => acc + d * (arr.length + 1 - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  n.push(dv(n));
  n.push(dv(n));
  return n.join("");
}

const FIRST = ["Mariana", "João", "Ana", "Pedro", "Juliana", "Lucas", "Fernanda", "Rafael", "Camila", "Bruno", "Patrícia", "Gustavo", "Larissa", "Rodrigo", "Beatriz", "Thiago", "Aline", "Marcelo", "Débora", "Felipe", "Carolina", "Eduardo", "Renata", "Diego", "Simone"];
const LAST = ["Souza", "Oliveira", "Santos", "Pereira", "Lima", "Carvalho", "Ribeiro", "Almeida", "Gomes", "Martins", "Rocha", "Kowalski", "Schneider", "Andrade", "Barbosa"];
const DISTRICTS = ["Centro", "Batel", "Trianon", "Santa Cruz", "Bonsucesso", "Morro Alto", "Primavera"];

const TRIPS: { dest: string; type: string; price: [number, number]; costPct: [number, number]; supplier: string }[] = [
  { dest: "Porto Seguro - BA", type: "PACOTE", price: [450000, 1100000], costPct: [78, 86], supplier: "Operadora Horizonte Turismo (exemplo)" },
  { dest: "Maceió - AL", type: "PACOTE", price: [500000, 1200000], costPct: [78, 85], supplier: "Operadora Horizonte Turismo (exemplo)" },
  { dest: "Gramado - RS", type: "PACOTE", price: [300000, 800000], costPct: [76, 84], supplier: "Operadora Horizonte Turismo (exemplo)" },
  { dest: "Foz do Iguaçu - PR", type: "HOTEL", price: [120000, 350000], costPct: [80, 88], supplier: "Rede Hotéis Mar Azul (exemplo)" },
  { dest: "Balneário Camboriú - SC", type: "HOTEL", price: [150000, 420000], costPct: [80, 88], supplier: "Rede Hotéis Mar Azul (exemplo)" },
  { dest: "Lisboa - Portugal", type: "AEREO", price: [450000, 900000], costPct: [88, 94], supplier: "Consolidadora Rota Brasil (exemplo)" },
  { dest: "Buenos Aires - Argentina", type: "AEREO", price: [180000, 400000], costPct: [88, 94], supplier: "Consolidadora Rota Brasil (exemplo)" },
  { dest: "Santiago - Chile", type: "PACOTE", price: [550000, 1300000], costPct: [80, 87], supplier: "Operadora Horizonte Turismo (exemplo)" },
  { dest: "Orlando - EUA", type: "PACOTE", price: [1200000, 2600000], costPct: [82, 88], supplier: "Operadora Horizonte Turismo (exemplo)" },
  { dest: "Litoral brasileiro (cruzeiro)", type: "CRUZEIRO", price: [600000, 1500000], costPct: [0, 0], supplier: "Cruzeiros Atlântico (exemplo)" },
  { dest: "Bonito - MS", type: "PASSEIO", price: [80000, 250000], costPct: [75, 85], supplier: "Receptivo Bonito Natureza (exemplo)" },
];

async function main() {
  const existing = await prisma.company.findFirst({ where: { isDemo: true } });
  if (existing) {
    console.log("Já existem dados de demonstração. Para recriar, apague o banco de desenvolvimento (prisma/dev.db) e rode 'npm run db:push && npm run db:seed'.");
    return;
  }
  const hash = await bcrypt.hash(PASSWORD, 10);

  // ------------------------------------------------------------- Empresa principal
  const company = await prisma.company.create({
    data: { name: "Azul Viagens Guarapuava (DEMONSTRAÇÃO)", document: "11222333000181", timezone: TZ, isDemo: true },
  });
  const mkUser = (name: string, email: string, role: string, commissionRateBps = 0) =>
    prisma.user.create({ data: { companyId: company.id, name, email, role, passwordHash: hash, commissionRateBps } });
  const admin = await mkUser("Helena Admin", "admin@azulviagens.demo", "ADMIN");
  const gestora = await mkUser("Gestora Paula", "gestora@azulviagens.demo", "GESTOR", 1000);
  const ana = await mkUser("Ana Vendedora", "ana@azulviagens.demo", "VENDEDOR", 1000);
  const carlos = await mkUser("Carlos Vendedor", "carlos@azulviagens.demo", "VENDEDOR", 800);
  const fin = await mkUser("Fábio Financeiro", "financeiro@azulviagens.demo", "FINANCEIRO");
  const ctx = async (id: string) => (await loadContext(id)) as Ctx;
  const cAdmin = await ctx(admin.id);
  const cFin = await ctx(fin.id);
  const sellers = [await ctx(ana.id), await ctx(carlos.id), await ctx(gestora.id)];

  const bank = await prisma.financialAccount.create({ data: { companyId: company.id, name: "Banco (exemplo) — conta corrente", type: "BANCO", bankName: "Banco Exemplo", initialBalanceCents: 2500000 } });
  const cash = await prisma.financialAccount.create({ data: { companyId: company.id, name: "Caixa da loja", type: "CAIXA", initialBalanceCents: 150000 } });
  const cards = await prisma.financialAccount.create({ data: { companyId: company.id, name: "Recebíveis de cartão", type: "RECEBIVEIS" } });

  const supplierCat: Record<string, string> = {
    "Operadora Horizonte Turismo (exemplo)": "OPERADORA",
    "Rede Hotéis Mar Azul (exemplo)": "HOTEL",
    "Consolidadora Rota Brasil (exemplo)": "CONSOLIDADORA",
    "Cruzeiros Atlântico (exemplo)": "OPERADORA",
    "Receptivo Bonito Natureza (exemplo)": "RECEPTIVO",
    "Seguro Viagem Protege (exemplo)": "SEGURADORA",
    "Transfer Express (exemplo)": "TRANSPORTADORA",
  };
  const suppliers: Record<string, string> = {};
  for (const [name, category] of Object.entries(supplierCat)) {
    const s = await prisma.supplier.create({
      data: { companyId: company.id, name, category, contactName: "Contato comercial", email: `contato@${name.split(" ")[1].toLowerCase()}.exemplo`, phone: "(41) 3000-0000", bankInfo: "Banco Exemplo · Ag 0001 · CC 12345-6" },
    });
    suppliers[name] = s.id;
  }

  const clients: { id: string; owner: Ctx }[] = [];
  for (let i = 0; i < 28; i++) {
    const name = `${FIRST[i % FIRST.length]} ${pick(LAST)} ${pick(LAST)}`;
    const owner = sellers[i % 2];
    const complete = rnd() > 0.15;
    const c = await prisma.client.create({
      data: {
        companyId: company.id,
        name,
        document: complete ? cpf() : null,
        whatsapp: `(42) 9${between(8000, 9999)}-${between(1000, 9999)}`,
        email: `${name.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.${i}@email.exemplo`,
        birthDate: `${between(1958, 2000)}-${String(between(1, 12)).padStart(2, "0")}-${String(between(1, 28)).padStart(2, "0")}`,
        zipCode: "85010-000",
        street: complete ? `Rua Exemplo ${between(1, 300)}` : null,
        number: String(between(10, 2000)),
        district: pick(DISTRICTS),
        city: "Guarapuava",
        state: "PR",
        consentMessaging: rnd() > 0.3,
        ownerId: owner.userId,
      },
    });
    clients.push({ id: c.id, owner });
  }

  await seedTemplates(company.id);

  // ------------------------------------------------------------- Vendas (12 meses)
  let created = 0;
  for (let m = 11; m >= 0; m--) {
    const monthStart = addMonths(startOfMonth(TODAY), -m);
    const count = m === 0 ? 4 : between(4, 8) + (m <= 2 ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const saleDate = addDays(monthStart, between(0, 27));
      if (saleDate > TODAY) continue;
      const cl = pick(clients);
      const seller = rnd() > 0.15 ? cl.owner : pick(sellers);
      const trip = pick(TRIPS);
      const price = round(between(trip.price[0], trip.price[1]));
      const isCruise = trip.type === "CRUZEIRO";
      const cost = isCruise ? 0 : round((price * between(trip.costPct[0], trip.costPct[1])) / 100, 100);
      const tripStart = addDays(saleDate, between(15, 120));
      const items = [
        {
          productType: trip.type,
          description: isCruise ? "Cabine externa 7 noites" : trip.type === "PACOTE" ? `Pacote ${between(4, 9)} noites com aéreo` : null,
          supplierId: suppliers[trip.supplier],
          commercialModel: isCruise ? "COMISSAO" : rnd() > 0.85 ? "REVENDA" : "INTERMEDIACAO",
          priceCents: price,
          costCents: cost,
          supplierCommissionCents: isCruise ? round(price * 0.12, 100) : 0,
          supplierDueDate: isCruise ? addDays(tripStart, 30) : addDays(tripStart, -between(10, 25)) < saleDate ? addDays(saleDate, 5) : addDays(tripStart, -between(10, 25)),
        },
      ];
      if (rnd() > 0.55 && !isCruise) {
        const insurance = round(between(12000, 45000), 100);
        items.push({ productType: "SEGURO", description: "Seguro viagem", supplierId: suppliers["Seguro Viagem Protege (exemplo)"], commercialModel: "INTERMEDIACAO", priceCents: insurance, costCents: round(insurance * 0.7, 100), supplierCommissionCents: 0, supplierDueDate: addDays(saleDate, 10) });
      }
      const fees = rnd() > 0.7 ? 15000 : 0;
      const discount = rnd() > 0.8 ? round(price * 0.03, 100) : 0;
      const clientPays = items.filter((i) => i.commercialModel !== "COMISSAO").reduce((a, i) => a + i.priceCents, 0) + fees - discount;
      const method = pick(["PIX", "CARTAO_CREDITO", "BOLETO", "PIX", "TRANSFERENCIA"]);
      const n = clientPays <= 0 ? 0 : method === "PIX" && rnd() > 0.4 ? 1 : between(2, 6);
      const payments = n === 0 ? [] : splitInstallments(clientPays, n).map((amount, i) => ({ key: `seed-${created}-${i}`, dueDate: addMonths(saleDate, i), amountCents: amount, method }));
      const status = m === 0 && k === count - 1 ? "draft" : rnd() > 0.96 ? "cancel" : "ok";
      const sale = await createSale(seller, {
        saleDate,
        clientId: cl.id,
        sellerId: seller.userId,
        destination: trip.dest,
        tripStart,
        tripEnd: addDays(tripStart, between(4, 10)),
        passengerCount: between(1, 4),
        locator: rnd() > 0.1 ? `LOC${between(10000, 99999)}` : null,
        feesCents: fees,
        discountCents: discount,
        commission: seller.role === "VENDEDOR" || rnd() > 0.5 ? { mode: "PERCENTUAL", bps: seller.userId === carlos.id ? 800 : 1000 } : { mode: "VALOR", amountCents: 0 },
        items,
        payments,
        passengers: [],
        confirm: status !== "draft",
      });
      created++;
      if (status === "cancel") await cancelSale(cAdmin, sale.id, "Cliente desistiu da viagem (exemplo).");
    }
  }

  // Exemplo obrigatório do briefing: pacote R$ 8.000, custo R$ 6.500, comissão R$ 200, 4 × R$ 2.000
  const mariana = await prisma.client.create({
    data: { companyId: company.id, name: "Mariana Exemplo da Silva", document: cpf(), whatsapp: "(42) 99999-0000", email: "mariana@email.exemplo", street: "Rua XV de Novembro", number: "100", district: "Centro", city: "Guarapuava", state: "PR", zipCode: "85010-000", consentMessaging: true, ownerId: ana.id },
  });
  await createSale(sellers[0], {
    saleDate: TODAY,
    clientId: mariana.id,
    destination: "Porto Seguro - BA",
    tripStart: addDays(TODAY, 60),
    tripEnd: addDays(TODAY, 67),
    passengerCount: 2,
    locator: "EXEMPLO8000",
    commission: { mode: "VALOR", amountCents: 20000 },
    items: [{ productType: "PACOTE", description: "Pacote 7 noites com aéreo — exemplo do briefing", supplierId: suppliers["Operadora Horizonte Turismo (exemplo)"], commercialModel: "INTERMEDIACAO", priceCents: 800000, costCents: 650000, supplierDueDate: addDays(TODAY, 40) }],
    payments: [0, 1, 2, 3].map((i) => ({ key: `exemplo-${i}`, dueDate: addMonths(TODAY, i), amountCents: 200000, method: "PIX" })),
    passengers: [{ name: "Mariana Exemplo da Silva" }, { name: "Acompanhante Exemplo" }],
    confirm: true,
  });

  // ------------------------------------------------------------- Despesas operacionais recorrentes
  const firstMonth = addMonths(startOfMonth(TODAY), -11);
  for (const e of [
    { description: "Aluguel da loja", category: "ALUGUEL", amountCents: 320000, day: 10 },
    { description: "Folha de pagamento", category: "SALARIOS", amountCents: 950000, day: 5 },
    { description: "Sistemas e software", category: "SISTEMAS", amountCents: 45000, day: 15 },
    { description: "Marketing digital", category: "MARKETING", amountCents: 120000, day: 20 },
    { description: "Contabilidade", category: "ADMINISTRATIVAS", amountCents: 60000, day: 12 },
  ]) {
    await createManualPayable(cFin, { description: e.description, category: e.category, amountCents: e.amountCents, firstDueDate: `${firstMonth.slice(0, 8)}${String(e.day).padStart(2, "0")}`, recurringMonths: 14, method: "TRANSFERENCIA" });
  }
  await createManualPayable(cFin, { description: "Impostos (Simples Nacional)", category: "IMPOSTOS", amountCents: 180000, firstDueDate: addDays(TODAY, -3), method: "BOLETO" });

  // ------------------------------------------------------------- Baixas: tudo que venceu até alguns dias atrás
  const cutoff = addDays(TODAY, -2);
  const recs = await prisma.receivable.findMany({ where: { companyId: company.id, status: "PENDENTE", dueDate: { lte: cutoff } }, orderBy: { dueDate: "asc" } });
  for (const r of recs) {
    const roll = rnd();
    if (roll < 0.06) continue; // inadimplência de exemplo
    const account = r.method === "CARTAO_CREDITO" ? cards.id : r.method === "DINHEIRO" ? cash.id : bank.id;
        const late = addDays(r.dueDate, between(0, 3));
    const date = late > cutoff ? cutoff : late;
    const amount = roll < 0.1 ? Math.round(r.amountCents / 2) : r.amountCents;
    await settleEntry(cFin, "receivable", r.id, { date, amountCents: amount, accountId: account, method: r.method ?? "PIX" });
  }
  const pays = await prisma.payable.findMany({ where: { companyId: company.id, status: "PENDENTE", dueDate: { lte: cutoff } }, orderBy: { dueDate: "asc" } });
  for (const p of pays) {
    if (rnd() < 0.05) continue;
    await settleEntry(cFin, "payable", p.id, { date: p.dueDate, amountCents: p.amountCents, accountId: bank.id, method: "TRANSFERENCIA" });
  }
  await createTransfer(cFin, { fromAccountId: cards.id, toAccountId: bank.id, amountCents: 500000, date: addDays(TODAY, -15), description: "Antecipação de recebíveis (exemplo)" });
  await createTransfer(cFin, { fromAccountId: cash.id, toAccountId: bank.id, amountCents: 80000, date: addDays(TODAY, -7), description: "Depósito do caixa" });

  await prisma.automationSetting.createMany({
    data: [
      { companyId: company.id, key: "pagamento_vencendo.evento", enabled: true },
      { companyId: company.id, key: "viagem_proxima.evento", enabled: true },
    ],
  });

  // ------------------------------------------------------------- Segunda agência (isolamento multi-tenant)
  const other = await prisma.company.create({ data: { name: "Agência Exemplo B (DEMONSTRAÇÃO)", timezone: TZ, isDemo: true } });
  const otherAdmin = await prisma.user.create({ data: { companyId: other.id, name: "Admin Agência B", email: "admin@agenciab.demo", role: "ADMIN", passwordHash: hash } });
  const oc = await prisma.client.create({ data: { companyId: other.id, name: "Cliente da Agência B", document: cpf() } });
  await prisma.financialAccount.create({ data: { companyId: other.id, name: "Conta da Agência B", type: "BANCO" } });
  await createSale((await loadContext(otherAdmin.id))!, {
    saleDate: TODAY,
    clientId: oc.id,
    destination: "Natal - RN",
    commission: { mode: "VALOR", amountCents: 0 },
    items: [{ productType: "HOTEL", commercialModel: "INTERMEDIACAO", priceCents: 300000, costCents: 250000 }],
    payments: [{ key: "b1", dueDate: TODAY, amountCents: 300000, method: "PIX" }],
    confirm: true,
  });

  console.log(`Demonstração criada: ${created + 1} vendas. Login: admin@azulviagens.demo / ${PASSWORD} (ver README para os demais perfis).`);
}

async function seedTemplates(companyId: string) {
  const header = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE INTERMEDIAÇÃO TURÍSTICA
[MODELO DE DEMONSTRAÇÃO — submeta à revisão jurídica da agência antes do uso]

CONTRATADA: {{agencia.nome}}, CNPJ {{agencia.documento}}.
CONTRATANTE: {{cliente.nome}}, CPF/CNPJ {{cliente.documento}}, residente em {{cliente.endereco}}, telefone {{cliente.telefone}}, e-mail {{cliente.email}}.

1. OBJETO
A CONTRATADA intermedeia, em nome do CONTRATANTE, a aquisição dos serviços turísticos abaixo, referentes à venda {{venda.codigo}} de {{venda.data}}:
{{venda.produtos}}

Destino: {{venda.destino}} · Período: {{venda.inicio}} a {{venda.retorno}} · Passageiros: {{venda.passageiros}} · Localizador: {{venda.localizador}}
{{venda.lista_passageiros}}

2. PREÇO E PAGAMENTO
Valor total: {{venda.valor_total}}, pago da seguinte forma:
{{venda.pagamento}}

3. CONDIÇÕES ESPECÍFICAS
{{clausulas}}

4. DISPOSIÇÕES GERAIS
4.1. Os serviços são prestados pelos fornecedores indicados, cabendo à CONTRATADA a intermediação e o suporte ao CONTRATANTE.
4.2. Documentação de viagem (documento de identidade, passaporte, vistos e vacinas) é de responsabilidade do CONTRATANTE.
4.3. Fica eleito o foro da comarca de Guarapuava/PR.

Guarapuava, {{venda.data}}.

_______________________________          _______________________________
{{agencia.nome}}                          {{cliente.nome}}
Consultor(a): {{vendedor.nome}}`;
  const templates = [
    { name: "Pacote turístico", productType: "PACOTE", clauses: "3.1. Cancelamentos estão sujeitos às regras da operadora, com multas que podem variar conforme a antecedência.\n3.2. Alterações de datas dependem de disponibilidade e podem gerar diferença tarifária.\n3.3. Reembolsos seguem os prazos e condições do fornecedor." },
    { name: "Passagem aérea", productType: "AEREO", clauses: "3.1. Tarifas aéreas seguem as regras da companhia (franquia de bagagem, remarcação e reembolso).\n3.2. Alterações de nome não são permitidas na maioria das tarifas.\n3.3. Não comparecimento (no-show) pode implicar perda integral do valor." },
    { name: "Hospedagem", productType: "HOTEL", clauses: "3.1. Cancelamento conforme política do hotel informada no momento da reserva.\n3.2. Horários de check-in e check-out definidos pelo meio de hospedagem." },
    { name: "Cruzeiro", productType: "CRUZEIRO", clauses: "3.1. O pagamento é realizado diretamente à companhia marítima, conforme suas condições.\n3.2. Cancelamentos seguem a tabela de penalidades da companhia marítima." },
    { name: "Outros serviços", productType: "OUTROS", clauses: "3.1. Cancelamentos e alterações seguem as condições do fornecedor do serviço." },
  ];
  for (const t of templates) await prisma.contractTemplate.create({ data: { companyId, name: t.name, productType: t.productType, body: header, clauses: t.clauses } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
