/** Planilha de clientes em .xlsx no formato exportado pelo Monde (arquivo montado no teste, sem dados reais). */
import { beforeAll, describe, expect, it } from "vitest";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { prisma } from "@/server/db";
import { readXlsxRows } from "@/lib/xlsx";
import { importClientRows, mapClientRows, parseDate } from "@/server/services/client-import";
import { makeCompany } from "./helpers";

/** Monta um .xlsx mínimo (zip com sharedStrings e sheet1), um arquivo comprimido e outro sem compressão. */
function makeXlsx(rows: (string | number)[][]) {
  const strings: string[] = [];
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const col = (i: number) => String.fromCharCode(65 + i);
  const sheet =
    `<?xml version="1.0"?><worksheet><sheetData>` +
    rows
      .map(
        (r, ri) =>
          `<row r="${ri + 1}">` +
          r
            .map((v, ci) => {
              if (v === "") return "";
              if (typeof v === "number") return `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>`;
              strings.push(v);
              return `<c r="${col(ci)}${ri + 1}" t="s"><v>${strings.length - 1}</v></c>`;
            })
            .join("") +
          `</row>`,
      )
      .join("") +
    `</sheetData></worksheet>`;
  const shared = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
  const files = [
    { name: "xl/sharedStrings.xml", data: Buffer.from(shared), deflate: true },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheet), deflate: false },
  ];
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.deflate ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(f.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
const inflate = async (d: Uint8Array) => new Uint8Array(inflateRawSync(d));

const HEADER = ["Nome", "E-mail", "Celular", "Cidade", "UF", "Razão Social", "CPF", "Sexo", "Nascimento (Fundação)", "Idade", "CNPJ", "Número Passaporte", "Validade Passaporte", "Doc. Estrangeiro", "País"];

describe("planilha de clientes .xlsx (exportação do Monde)", () => {
  let env: Awaited<ReturnType<typeof makeCompany>>;
  beforeAll(async () => {
    env = await makeCompany("Planilha xlsx");
  });

  it("converte datas do Excel (número de série)", () => {
    expect(parseDate("31527")).toBe("1986-04-25");
    expect(parseDate("47484")).toBe("2030-01-01");
    expect(parseDate("12")).toBeNull();
  });

  it("lê o .xlsx e liga as colunas do Monde", async () => {
    const rows = await readXlsxRows(makeXlsx([HEADER, ["Ana Teste", "ana@x.com", "41999990000", "Curitiba", "PR", "", "39053344705", "F", 31527, 40, "", "AB123456", 47484, "", "Brasil"]]), inflate);
    expect(rows[1][0]).toBe("Ana Teste");
    expect(rows[1][8]).toBe("31527");
    const fields = mapClientRows(rows[0], []).columns.map((c) => c.field);
    expect(fields).toEqual(expect.arrayContaining(["name", "legalName", "document", "cnpj", "birthDate", "passportNumber", "passportExpiry", "rne", "gender"]));
  });

  it("importa pessoa física e empresa (razão social e CNPJ em colunas próprias)", async () => {
    const rows = await readXlsxRows(
      makeXlsx([
        HEADER,
        ["Ana Teste", "ana@x.com", "41999990000", "Curitiba", "PR", "", "39053344705", "F", 31527, 40, "", "AB123456", 47484, "", "Brasil"],
        ["Recanto Viagens", "", "", "", "", "Recanto Turismo Ltda", "", "", "", "", "11444777000161", "", "", "", ""],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ]),
      inflate,
    );
    const [header, ...data] = rows;
    const r = await importClientRows(env.admin, { header, rows: data, firstLine: 2, last: true });
    expect(r).toMatchObject({ criados: 2, erros: [] });
    const ana = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, document: "39053344705" } });
    expect(ana).toMatchObject({ name: "Ana Teste", birthDate: "1986-04-25", passportNumber: "AB123456", passportExpiry: "2030-01-01", gender: "F", city: "Curitiba", state: "PR" });
    const pj = await prisma.client.findFirstOrThrow({ where: { companyId: env.company.id, document: "11444777000161" } });
    expect(pj).toMatchObject({ personType: "PJ", name: "Recanto Turismo Ltda", tradeName: "Recanto Viagens" });
  });

  it("recusa pedaço grande demais e exige permissão", async () => {
    await expect(importClientRows(env.admin, { header: HEADER, rows: Array.from({ length: 251 }, () => ["x"]), firstLine: 2, last: true })).rejects.toThrow(/250/);
    await expect(importClientRows(env.fin, { header: HEADER, rows: [], firstLine: 2, last: true })).rejects.toThrow();
  });
});
