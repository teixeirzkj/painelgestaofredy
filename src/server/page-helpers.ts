import { notFound } from "next/navigation";
import { AppError } from "./errors";

/** Converte "não encontrado"/"sem permissão" de serviços em página 404 (não revela se o registro existe). */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN" || e.code === "VALIDATION")) notFound();
    throw e;
  }
}
