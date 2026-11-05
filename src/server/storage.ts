import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";

/**
 * Armazenamento de arquivos (comprovantes, vouchers, faturas, logos).
 * - "disk" (padrão no desenvolvimento): ./storage/<companyId>/<uuid>
 * - "database" (padrão na Vercel, onde o disco não é persistente): tabela StoredFile no PostgreSQL
 * Defina STORAGE_DRIVER para forçar um dos dois. Para grandes volumes, troque por um bucket privado (S3/R2)
 * mantendo esta mesma interface.
 */
const ROOT = path.resolve(process.cwd(), "storage");
const driver = () => process.env.STORAGE_DRIVER ?? (process.env.VERCEL ? "database" : "disk");

export async function saveFile(companyId: string, data: Buffer, ext: string): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5);
  const key = `${companyId}/${randomUUID()}${safeExt ? "." + safeExt : ""}`;
  if (driver() === "database") {
    await prisma.storedFile.create({ data: { key, companyId, data: new Uint8Array(data), sizeBytes: data.length } });
    return key;
  }
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  const row = await prisma.storedFile.findUnique({ where: { key } });
  if (row) return Buffer.from(row.data);
  return readFile(resolveKey(key));
}

function resolveKey(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Caminho inválido.");
  return full;
}
