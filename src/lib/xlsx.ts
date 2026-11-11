/**
 * Leitor mínimo de planilha .xlsx (primeira aba) sem dependências: o .xlsx é um zip com XML.
 * Funciona no navegador e no servidor; quem chama fornece a descompressão "deflate-raw"
 * (navegador: DecompressionStream; Node: zlib.inflateRawSync).
 * Devolve as linhas como texto. Datas do Excel chegam como número de série (ex.: 31527): o
 * importador de clientes converte (parseDate).
 */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

/** Descompressão no navegador (Chrome, Edge, Firefox e Safari atuais). */
export const browserInflate: Inflate = async (data) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

async function unzip(buf: Uint8Array, inflate: Inflate, wanted: (name: string) => boolean) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // fim do diretório central (assinatura 0x06054b50), procurado de trás para frente
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("Arquivo .xlsx inválido.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const dec = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Arquivo .xlsx inválido.");
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + size);
    if (method === 0) out.set(name, dec.decode(raw));
    else if (method === 8) out.set(name, dec.decode(await inflate(raw)));
    else throw new Error("Compressão do .xlsx não suportada.");
  }
  return out;
}

const decodeXml = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1])).join("");
const column = (ref: string) => {
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)?.[0] ?? "A") n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Linhas da primeira aba da planilha. */
export async function readXlsxRows(data: ArrayBuffer | Uint8Array, inflate: Inflate): Promise<string[][]> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  const files = await unzip(buf, inflate, (n) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  // primeira aba pela ordem do workbook (não necessariamente sheet1.xml)
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rid = files.get("xl/workbook.xml")?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid && files.get("xl/_rels/workbook.xml.rels")?.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  if (target) sheetPath = "xl/" + target.replace(/^\/?xl\//, "").replace(/^\.\//, "");
  const sheet = files.get(sheetPath) ?? [...files.entries()].find(([n]) => n.startsWith("xl/worksheets/"))?.[1];
  if (!sheet) throw new Error("A planilha não tem abas.");
  const shared = [...(files.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const inner = cm[2] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = texts(inner);
      else if (v != null) value = decodeXml(v);
      row[ref ? column(ref) : row.length] = value;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}
