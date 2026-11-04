"use client";
import { AlertTriangle } from "lucide-react";
import { Button, Card } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const notFound = /não encontrad/i.test(error.message);
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
      <h2 className="mt-3 text-lg font-semibold">{notFound ? "Registro não encontrado" : "Não foi possível carregar esta página"}</h2>
      <p className="mt-1 text-sm text-muted">
        {notFound ? "Ele pode ter sido removido ou você não tem acesso a ele." : "Tente novamente. Se o problema continuar, contate o suporte."}
      </p>
      <Button className="mt-5" onClick={reset}>
        Tentar novamente
      </Button>
    </Card>
  );
}
