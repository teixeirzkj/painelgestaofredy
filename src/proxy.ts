import { NextResponse, type NextRequest } from "next/server";

/**
 * Proteção contra envio de formulário vindo de outro site (CSRF).
 * A venda rápida roda embutida no WTS com um login que o navegador manda também em contexto de terceiros;
 * por isso nenhuma escrita (POST/PUT/PATCH/DELETE) é aceita quando o navegador diz que ela veio de outro site.
 * Chamadas servidor a servidor (webhooks, API com chave) não mandam Sec-Fetch-Site e passam normalmente.
 */
export function proxy(request: NextRequest) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Requisição de outro site bloqueada." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
