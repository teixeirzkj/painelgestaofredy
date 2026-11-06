"use client";
import { Copy, ExternalLink, MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader } from "@/components/ui";

/** Link da venda rápida (popup) para colocar no Frédy ou no navegador do vendedor. */
export function QuickSaleLink({ base }: { base: string }) {
  const url = `${base}/balcao`;
  const withCard = `${url}?card=ID_DO_CARD`;
  const popup = `window.open("${url}", "vendaRapida", "width=1100,height=900")`;
  const copy = (t: string) =>
    navigator.clipboard.writeText(t).then(
      () => toast.success("Copiado."),
      () => toast.error("Não foi possível copiar. Selecione o texto e copie."),
    );
  const Row = ({ label, value, hint }: { label: string; value: string; hint: string }) => (
    <div className="space-y-1">
      <p className="text-xs font-medium text-ink">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs">{value}</code>
        <button type="button" onClick={() => copy(value)} className="rounded-lg border border-line p-2 text-muted hover:bg-slate-50 hover:text-ink" aria-label={`Copiar ${label}`}>
          <Copy className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[11px] text-muted">{hint}</p>
    </div>
  );
  return (
    <Card className="mt-6">
      <CardHeader
        title="Venda rápida (popup do vendedor)"
        icon={MonitorSmartphone}
        description="Uma tela só com cliente, venda e contrato, sem o menu da gestão. O vendedor entra uma vez com o login dele e a tela fica aberta."
        action={
          <a href={url} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
            Abrir <ExternalLink className="h-3.5 w-3.5" />
          </a>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        <Row label="Link da tela" value={url} hint="Cadastre como atalho no Frédy ou nos favoritos do vendedor." />
        <Row
          label="Link a partir de um card do Frédy"
          value={withCard}
          hint="Troque ID_DO_CARD pelo id do card: a tela já abre com o contato do card, o valor e os campos mapeados, e a venda fica ligada ao card (ao confirmar, o card vira ganho com o valor final)."
        />
        <Row label="Abrir como janela popup (para um botão)" value={popup} hint="Comando para um botão ou link que abra a tela em uma janela separada." />
        <p className="text-[11px] text-muted">Também aceita ?nome=, ?telefone=, ?email= e ?cpf= para pré-preencher o cadastro do cliente.</p>
      </div>
    </Card>
  );
}
