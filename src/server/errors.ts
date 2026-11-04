/** Erro de negócio com mensagem segura para exibição ao usuário. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: "VALIDATION" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "UNAUTHENTICATED" = "VALIDATION",
    public issues?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; issues?: { field: string; message: string }[] };

/** Executa uma operação e converte erros em resultado serializável para server actions. */
export async function toResult<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, issues: e.issues };
    // ZodError
    if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
      const issues = (e as { issues: { path: (string | number)[]; message: string }[] }).issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      return { ok: false, error: issues[0]?.message ?? "Dados inválidos.", issues };
    }
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect/notFound do Next
    console.error(e);
    return { ok: false, error: "Erro inesperado. Tente novamente ou contate o suporte." };
  }
}
