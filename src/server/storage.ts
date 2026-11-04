import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Armazenamento de arquivos (comprovantes). Implementação local para desenvolvimento:
 * arquivos em ./storage/<companyId>/<uuid>. Em produção substitua por um bucket
 * privado (S3, R2, GCS) mantendo esta mesma interface.
 */
const ROOT = path.resolve(process.cwd(), "storage");

export async function saveFile(companyId: string, data: Buffer, ext: string): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 5);
  const key = `${companyId}/${randomUUID()}${safeExt ? "." + safeExt : ""}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

function resolveKey(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Caminho inválido.");
  return full;
}
