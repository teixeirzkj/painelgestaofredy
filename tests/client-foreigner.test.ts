/** Cliente estrangeiro: passaporte ou RNE no lugar do CPF, sexo, nascimento e validade do passaporte. */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { listClients, saveClient, searchClients } from "@/server/services/registry";
import { clientMissing } from "@/server/services/balcao";
import { createSale, listSales } from "@/server/services/sales";
import { getDashboard } from "@/server/services/dashboard";
import { clientVars, createSuggestedTemplates, renderTemplate } from "@/server/services/contracts";
import { SUGGESTED_TEMPLATE_BODY } from "@/server/services/contract-defaults";
import { importClientsCsv, parseClientCsv } from "@/server/services/client-import";
import { mapMondePerson } from "@/server/services/monde";
import { clientIdentity, hasClientDocument, isBrazilianNationality, normalizeGender } from "@/lib/client-identity";
import { makeCompany, exampleSale } from "./helpers";

type Env = Awaited<ReturnType<typeof makeCompany>>;

const juan = {
  name: "Juan Pérez",
  foreigner: true,
  nationality: "Argentina",
  passportNumber: "aab 123456",
  passportExpiry: "2031-03-10",
  rne: "v1234567",
  gender: "M",
  birthDate: "1985-08-15",
  street: "Rua B",
  number: "2",
  city: "Guarapuava",
  state: "PR",
};

describe("regras puras do documento do cliente", () => {
  it("sexo: aceita palavras e ignora o que não reconhece", () => {
    expect(normalizeGender("feminino")).toBe("F");
    expect(normalizeGender("Masculino")).toBe("M");
    expect(normalizeGender("x")).toBeNull();
    expect(normalizeGender(null)).toBeNull();
  });

  it("nacionalidade brasileira", () => {
    expect(isBrazilianNationality("Brasileira")).toBe(true);
    expect(isBrazilianNationality("Brasil")).toBe(true);
    expect(isBrazilianNationality("Argentina")).toBe(false);
  });

  it("identificação: CPF, passaporte ou RNE", () => {
    expect(clientIdentity({ document: "52998224725" }, { mask: false })).toBe("CPF 529.982.247-25");
    const f = { document: null, foreigner: true, passportNumber: "AAB123456", nationality: "Argentina" };
    expect(clientIdentity(f, { mask: false })).toBe("Passaporte nº AAB123456 (Argentina)");
    expect(clientIdentity(f, { mask: true })).toBe("Passaporte nº ******456 (Argentina)");
    expect(clientIdentity({ document: null, foreigner: true, rne: "V1234567" }, { mask: false })).toBe("RNE/RNM nº V1234567");
    // brasileiro sem CPF não vale pelo passaporte
    expect(hasClientDocument({ document: null, foreigner: false, passportNumber: "AAB123456" })).toBe(false);
  });

  it("venda rápida: o que falta no cadastro", () => {
    expect(clientMissing({ document: null, street: "Rua A" })).toEqual(["CPF/CNPJ"]);
    expect(clientMissing({ document: null, street: "Rua A", foreigner: true, passportNumber: "AAB123456" })).toEqual([]);
    expect(clientMissing({ document: null, street: "Rua A", foreigner: true, rne: "V1234567" })).toEqual([]);
    expect(clientMissing({ document: null, street: null, foreigner: true })).toEqual(["passaporte ou RNE", "endereço"]);
  });
});

describe("cadastro do cliente estrangeiro", () => {
  let env: Env;
  let other: Env;
  let juanId: string;
  beforeAll(async () => {
    env = await makeCompany("Estrangeiro");
    other = await makeCompany("Outra agência");
  });

  it("salva sem CPF, com passaporte e RNE em maiúsculas", async () => {
    const r = await saveClient(env.admin, null, juan);
    juanId = r.id;
    const c = await prisma.client.findUniqueOrThrow({ where: { id: r.id } });
    expect(c).toMatchObject({ document: null, foreigner: true, nationality: "Argentina", passportNumber: "AAB123456", rne: "V1234567", gender: "M", birthDate: "1985-08-15", passportExpiry: "2031-03-10" });
  });

  it("CPF informado continua sendo validado, também para estrangeiro", async () => {
    await expect(saveClient(env.admin, null, { name: "Ana Estrangeira", foreigner: true, document: "123.456.789-00" })).rejects.toThrow(/CPF\/CNPJ inválido/);
  });

  it("pessoa jurídica nunca fica como estrangeira", async () => {
    const r = await saveClient(env.admin, null, { name: "Empresa Turismo Ltda", personType: "PJ", foreigner: true, rne: "V999", nationality: "Chile", gender: "F" });
    const c = await prisma.client.findUniqueOrThrow({ where: { id: r.id } });
    expect(c).toMatchObject({ foreigner: false, rne: null, nationality: null, gender: null });
  });

  it("passaporte repetido na mesma agência é recusado; em outra agência, não", async () => {
    await expect(saveClient(env.admin, null, { name: "Outro Juan", passportNumber: "AAB123456" })).rejects.toThrow(/Já existe um cliente com este passaporte/);
    await expect(saveClient(other.admin, null, { name: "Juan Pérez", passportNumber: "AAB123456" })).resolves.toBeTruthy();
  });

  it("cadastros antigos com passaporte repetido continuam editáveis enquanto o passaporte não muda", async () => {
    const a = await prisma.client.create({ data: { companyId: env.company.id, name: "Duplicado Um", passportNumber: "DUP0001" } });
    await prisma.client.create({ data: { companyId: env.company.id, name: "Duplicado Dois", passportNumber: "DUP0001" } });
    await expect(saveClient(env.admin, a.id, { name: "Duplicado Um Editado", passportNumber: "DUP0001" })).resolves.toBeTruthy();
    await expect(saveClient(env.admin, juanId, { ...juan, passportNumber: "DUP0001" })).rejects.toThrow(/passaporte/);
  });

  it("busca acha por passaporte e RNE; o autocomplete não manda os números inteiros", async () => {
    const list = await listClients(env.admin, { q: "aab123" });
    expect(list.items.map((c) => c.id)).toContain(juanId);
    const found = await searchClients(env.admin, "V12345");
    const j = found.find((c) => c.id === juanId)!;
    expect(j).toBeTruthy();
    expect(j).not.toHaveProperty("passportNumber");
    expect(j).not.toHaveProperty("rne");
    expect(j.docHint).toBe("Passaporte nº ******456 (Argentina) · RNE/RNM nº *****567");
  });

  it("contrato: identifica pelo passaporte, inclusive em modelo antigo com CPF/CNPJ", async () => {
    const c = await prisma.client.findUniqueOrThrow({ where: { id: juanId } });
    const vars = clientVars(c);
    expect(vars["cliente.identificacao"]).toBe("Passaporte nº AAB123456 (Argentina) · RNE/RNM nº V1234567");
    expect(vars["cliente.documento"]).toBe("AAB123456 (passaporte)");
    expect(vars["cliente.nascimento"]).toBe("15/08/1985");
    expect(vars["cliente.nacionalidade"]).toBe("Argentina");
    const docLabels = ["Documento do cliente (CPF, CNPJ, passaporte ou RNE)", "CPF/CNPJ do cliente (ou passaporte/RNE do estrangeiro)"];
    const r1 = renderTemplate(SUGGESTED_TEMPLATE_BODY, "", vars);
    expect(r1.missing.filter((m) => docLabels.includes(m))).toEqual([]);
    expect(r1.content).toContain("Passaporte nº AAB123456");
    const r2 = renderTemplate("CONTRATANTE: {{cliente.nome}}, CPF/CNPJ {{cliente.documento}}", "", vars);
    expect(r2.missing).toEqual([]);
    expect(r2.content).toBe("CONTRATANTE: Juan Pérez, Passaporte nº AAB123456 (Argentina) · RNE/RNM nº V1234567");

    const br = await prisma.client.create({ data: { companyId: env.company.id, name: "Brasileiro Sem CPF", passportNumber: "BR0000001" } });
    const r3 = renderTemplate(SUGGESTED_TEMPLATE_BODY, "", clientVars(br));
    expect(r3.missing).toContain("Documento do cliente (CPF, CNPJ, passaporte ou RNE)");
  });

  it("passageiro ligado ao cadastro recebe nascimento e passaporte; o que foi digitado fica", async () => {
    const s = await createSale(
      env.admin,
      exampleSale(juanId, env.supplier.id, {
        confirm: false,
        passengers: [
          { name: "Juan Pérez", clientId: juanId },
          { name: "Maria Cliente", clientId: env.client.id, birthDate: "1990-01-01", passportNumber: "XY99999" },
        ],
      }),
    );
    const pax = await prisma.passenger.findMany({ where: { saleId: s.id }, orderBy: { name: "asc" } });
    const j = pax.find((p) => p.clientId === juanId)!;
    expect(j).toMatchObject({ document: "V1234567", birthDate: "1985-08-15", passportNumber: "AAB123456", passportExpiry: "2031-03-10" });
    const m = pax.find((p) => p.clientId === env.client.id)!;
    expect(m).toMatchObject({ document: "52998224725", birthDate: "1990-01-01", passportNumber: "XY99999" });
  });

  it("passageiro ligado a cliente fora do escopo do vendedor fica ligado, mas sem copiar documentos", async () => {
    const hidden = await prisma.client.create({
      data: { companyId: env.company.id, name: "Cliente do Outro", ownerId: env.seller2.userId, document: "11144477735", passportNumber: "HID12345", passportExpiry: "2030-01-01", rne: "V7654321", birthDate: "1970-02-02" },
    });
    const s = await createSale(
      env.seller,
      exampleSale(env.client.id, env.supplier.id, { confirm: false, passengers: [{ name: "Cliente do Outro", clientId: hidden.id }] }),
    );
    const [p] = await prisma.passenger.findMany({ where: { saleId: s.id } });
    expect(p).toMatchObject({ clientId: hidden.id, document: null, birthDate: null, passportNumber: null, passportExpiry: null });
  });

  it("passaporte antigo salvo sem normalizar: editar outro campo não trava por passaporte repetido", async () => {
    const legacy = await prisma.client.create({ data: { companyId: env.company.id, name: "Antigo Minúsculo", passportNumber: "fx 123456" } });
    await prisma.client.create({ data: { companyId: env.company.id, name: "Antigo Maiúsculo", passportNumber: "FX123456" } });
    await expect(saveClient(env.admin, legacy.id, { name: "Antigo Minúsculo Editado", passportNumber: "fx 123456" })).resolves.toBeTruthy();
  });

  it("pendências: estrangeiro com passaporte não conta como sem documento; brasileiro sem CPF conta", async () => {
    const fx = await makeCompany("Pendencias");
    const f = await saveClient(fx.admin, null, { ...juan, passportNumber: "PEND0001", rne: null });
    const b = await prisma.client.create({ data: { companyId: fx.company.id, name: "Sem CPF", street: "Rua C", city: "X" } });
    const sf = await createSale(fx.admin, exampleSale(f.id, fx.supplier.id));
    const sb = await createSale(fx.admin, exampleSale(b.id, fx.supplier.id));
    const pend = await listSales(fx.admin, { pending: true });
    const ids = pend.items.map((x) => x.id);
    expect(ids).toContain(sb.id);
    expect(ids).not.toContain(sf.id);
    const d = await getDashboard(fx.admin, { from: "2026-11-01", to: "2026-11-30" });
    expect(d.alerts.find((a) => a.key === "vendas-incompletas")?.count).toBe(1);
  });

  it("contrato da venda do estrangeiro sai com o passaporte", async () => {
    const fx = await makeCompany("Contrato estrangeiro");
    await createSuggestedTemplates(fx.admin);
    const f = await saveClient(fx.admin, null, { ...juan, passportNumber: "CTR00001" });
    const s = await createSale(fx.admin, exampleSale(f.id, fx.supplier.id));
    const c = await prisma.contract.findFirstOrThrow({ where: { saleId: s.id } });
    expect(c.content).toContain("Passaporte nº CTR00001 (Argentina)");
    expect(c.content).not.toContain("Documento do cliente (CPF, CNPJ, passaporte ou RNE) não informado");
  });
});

describe("importação com estrangeiro", () => {
  let env: Env;
  beforeAll(async () => {
    env = await makeCompany("Importa estrangeiro");
  });

  it("lê nacionalidade, RNE e sexo da planilha", () => {
    const { rows } = parseClientCsv("nome;passaporte;nacionalidade;rne;sexo\nJuan Pérez;aab123456;Argentina;v1234567;masculino\n");
    expect(rows[0]).toMatchObject({ name: "Juan Pérez", nationality: "Argentina", rne: "v1234567", gender: "masculino" });
  });

  it("estrangeiro sem CPF não duplica ao reimportar; brasileira não vira estrangeira", async () => {
    const csv = "nome;passaporte;nacionalidade;sexo\nJuan Import;IMP000111;Argentina;M\nAna Brasileira;;Brasileira;F\n";
    const r1 = await importClientsCsv(env.admin, csv);
    expect(r1.criados).toBe(2);
    const juanC = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, name: "Juan Import" } });
    expect(juanC).toMatchObject({ foreigner: true, passportNumber: "IMP000111", gender: "M" });
    const ana = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, name: "Ana Brasileira" } });
    expect(ana.foreigner).toBe(false);
    // mesma linha, nome escrito diferente: acha pelo passaporte
    const r2 = await importClientsCsv(env.admin, "nome;passaporte;nacionalidade\nJuan Importado;IMP000111;Argentina\n");
    expect(r2.criados).toBe(0);
    expect(await prisma.client.count({ where: { companyId: env.company.id, passportNumber: "IMP000111" } })).toBe(1);
  });

  it("cliente que já existia passa a estrangeiro quando a planilha traz RNE", async () => {
    await prisma.client.create({ data: { companyId: env.company.id, name: "Pedro Já Existia", email: "pedro@x.com" } });
    await importClientsCsv(env.admin, "nome;email;rne\nPedro Já Existia;pedro@x.com;rnm 777\n");
    const p = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, email: "pedro@x.com" } });
    expect(p).toMatchObject({ foreigner: true, rne: "RNM777" });
  });

  it("Monde: sexo vem do campo gender", () => {
    expect(mapMondePerson({ attributes: { name: "A B C", gender: "F" } } as never).gender).toBe("F");
  });
});
