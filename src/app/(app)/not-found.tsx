import { SearchX } from "lucide-react";
import { Card, LinkButton } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <SearchX className="mx-auto h-10 w-10 text-slate-400" />
      <h2 className="mt-3 text-lg font-semibold">Registro não encontrado</h2>
      <p className="mt-1 text-sm text-muted">Ele pode ter sido removido, estar cancelado ou você não tem acesso a ele.</p>
      <LinkButton href="/" className="mt-5">
        Voltar ao início
      </LinkButton>
    </Card>
  );
}
