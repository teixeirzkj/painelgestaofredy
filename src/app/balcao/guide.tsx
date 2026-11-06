"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, CheckCircle2, ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGuide } from "./guide-store";

/** O que o servidor sabe do atendimento (marcado sozinho no passo a passo). */
export type GuideFacts = {
  page: "cliente" | "venda" | "final";
  flowKey: string;
  inheritKey?: string;
  cardTitle?: string | null;
  clientChosen: boolean;
  clientComplete: boolean;
  clientMissing: string[];
  docs: number;
  saleExists: boolean;
  saleConfirmed: boolean;
  contractStatus: string | null;
  canContract: boolean;
  attachments: number;
};

type Step = {
  id: string;
  title: string;
  optional?: boolean;
  done: boolean;
  blocking: boolean;
  hint: React.ReactNode;
  showHintOn?: GuideFacts["page"];
  manual?: { label: string; enabled: boolean; note?: string };
};

const ISSUED = ["AGUARDANDO_ENVIO", "ENVIADO", "ASSINADO"];
const SENT = ["ENVIADO", "ASSINADO"];
const HIDE_KEY = "balcao-guia-oculto";

function buildSteps(f: GuideFacts, checks: Record<string, boolean>): Step[] {
  const issued = ISSUED.includes(f.contractStatus ?? "");
  const sentAuto = SENT.includes(f.contractStatus ?? "");
  return [
    {
      id: "card",
      title: "Fechar a venda no card do Frédy",
      done: f.saleExists || !!checks.card,
      blocking: true,
      hint: f.cardTitle ? (
        <>
          Esta tela foi aberta pelo card <strong>“{f.cardTitle}”</strong>. Confirme com o cliente que a venda está fechada. Quando você confirmar a venda aqui, o sistema marca o card como ganho no Frédy com o valor final.
        </>
      ) : (
        <>
          No Frédy, marque o card do cliente como <strong>ganho</strong>. Se a integração estiver ligada, a venda chega aqui como rascunho e aparece quando você escolher o cliente. Se o cliente não veio pelo Frédy, é só confirmar abaixo.
        </>
      ),
      manual: f.saleExists ? undefined : { label: f.cardTitle ? "O cliente fechou a venda" : "Já fechei a venda no card (ou o cliente não veio pelo Frédy)", enabled: true },
    },
    {
      id: "dados",
      title: "Cadastrar ou conferir os dados do cliente",
      done: f.clientComplete && (f.saleExists || !!checks.dados),
      blocking: true,
      hint: !f.clientChosen ? (
        "Busque o cliente pelo nome, CPF ou telefone. Se não achar, cadastre com CPF, endereço completo, WhatsApp e e-mail."
      ) : f.clientComplete ? (
        "Confira nome, CPF/CNPJ, endereço, WhatsApp e e-mail. Se algo estiver errado, clique em Editar no cadastro."
      ) : (
        <>
          Falta no cadastro: <strong>{f.clientMissing.join(" e ")}</strong>. Clique em <strong>Editar</strong> e complete: o contrato precisa desses dados.
        </>
      ),
      manual: f.saleExists ? undefined : { label: "Conferi os dados do cliente", enabled: f.clientChosen && f.clientComplete, note: f.clientChosen ? (f.clientComplete ? undefined : "Libera quando o cadastro tiver CPF/CNPJ e endereço.") : "Libera depois de escolher o cliente." },
    },
    {
      id: "docs",
      title: "Fotos dos documentos do cliente",
      optional: true,
      done: f.docs > 0,
      blocking: false,
      showHintOn: "cliente",
      hint: "Na seção Documentos do cliente, envie ou fotografe RG, CPF, CNH ou passaporte de quem vai viajar, com o número.",
    },
    {
      id: "venda",
      title: "Lançar e confirmar a venda",
      done: f.saleConfirmed,
      blocking: true,
      hint:
        f.page === "cliente" ? (
          <>
            Clique em <strong>Continuar: lançar a venda</strong>.
          </>
        ) : f.page === "venda" ? (
          <>
            Preencha destino, datas, passageiros, valor de venda, custo e fornecedor, a forma de pagamento e as parcelas. Depois clique em <strong>Confirmar venda</strong>. Venda salva como rascunho não gera o financeiro nem o contrato.
          </>
        ) : (
          <>
            A venda está em rascunho. Clique em <strong>Continuar e confirmar</strong>, confira o pagamento e confirme.
          </>
        ),
    },
    {
      id: "contrato",
      title: "Emitir o contrato",
      done: issued,
      blocking: f.canContract,
      hint: f.canContract ? (
        <>
          Clique em <strong>Atualizar prévia</strong>, leia o contrato e clique em <strong>Emitir contrato</strong>. Se aparecer “Falta para emitir”, complete o dado que falta e atualize a prévia.
        </>
      ) : (
        "Seu usuário não emite contratos. Avise o gestor que a venda foi confirmada."
      ),
    },
    {
      id: "enviar",
      title: "Enviar o contrato ao cliente",
      done: sentAuto || (issued && !!checks.enviar),
      blocking: f.canContract,
      hint: (
        <>
          Clique em <strong>Imprimir / salvar PDF</strong> e mande o arquivo ao cliente pelo WhatsApp, ou envie para assinatura online, se estiver ligada.
        </>
      ),
      manual: sentAuto || !f.canContract ? undefined : { label: "Enviei o contrato ao cliente", enabled: issued, note: issued ? undefined : "Libera depois de emitir o contrato." },
    },
    {
      id: "vouchers",
      title: "Anexar vouchers e comprovantes",
      optional: true,
      done: f.attachments > 0,
      blocking: false,
      showHintOn: "final",
      hint: "Na seção Documentos e vouchers, anexe vouchers, bilhetes e comprovantes. Dá para arrastar ou colar a imagem.",
    },
  ];
}

/** Passo a passo do atendimento, do card fechado ao contrato enviado. */
export function BalcaoGuide({ facts }: { facts: GuideFacts }) {
  const [checks, set] = useGuide(facts.flowKey, facts.inheritKey);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(HIDE_KEY) === "1") setOpen(false);
    } catch {}
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(HIDE_KEY, next ? "0" : "1");
    } catch {}
  };

  const steps = buildSteps(facts, checks);
  const current = steps.findIndex((s) => s.blocking && !s.done);
  const required = steps.filter((s) => s.blocking);
  const doneCount = required.filter((s) => s.done).length;
  const allDone = current === -1;

  return (
    <section className="no-print rounded-[14px] border border-brand-100 bg-white shadow-[var(--shadow-card)]" aria-label="Passo a passo do atendimento">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-3 px-5 py-3 text-left" aria-expanded={open}>
        <ListChecks className="h-5 w-5 shrink-0 text-brand-600" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">Passo a passo do atendimento</span>
          <span className="block truncate text-xs text-muted">
            {allDone ? "Tudo feito." : `${doneCount} de ${required.length} feitos · Agora: ${steps[current].title}`}
          </span>
        </span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden>
          <span className="block h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${(doneCount / required.length) * 100}%` }} />
        </span>
        {open ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
      </button>

      {open && (
        <ol className="space-y-1 border-t border-line px-3 py-3">
          {steps.map((s, i) => {
            const isCurrent = i === current;
            const showHint = isCurrent || (s.optional && !s.done && s.showHintOn === facts.page);
            const showManual = s.manual && (s.done || current === -1 || i <= current);
            return (
              <li key={s.id} className={cn("rounded-lg px-2 py-2", isCurrent && "bg-brand-25 ring-1 ring-brand-100")}>
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular",
                      s.done ? "bg-emerald-500 text-white" : isCurrent ? "bg-brand-600 text-white" : "bg-slate-100 text-muted",
                    )}
                  >
                    {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", s.done ? "text-emerald-800" : isCurrent ? "font-semibold text-ink" : "text-ink")}>
                      {s.title}
                      {s.optional && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-muted">recomendado</span>}
                    </p>
                    {showHint && !s.done && <p className="mt-1 text-xs leading-relaxed text-slate-600">{s.hint}</p>}
                    {showManual && s.manual && (
                      <label className={cn("mt-2 inline-flex items-start gap-2 text-sm", s.manual.enabled ? "cursor-pointer text-ink" : "cursor-not-allowed text-muted")}>
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 rounded border-line accent-emerald-600"
                          checked={!!checks[s.id]}
                          disabled={!s.manual.enabled}
                          onChange={(e) => set(s.id, e.target.checked)}
                        />
                        <span>
                          {s.manual.label}
                          {s.manual.note && !s.manual.enabled && <span className="block text-[11px] text-muted">{s.manual.note}</span>}
                        </span>
                      </label>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {allDone && (
            <li className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4" /> Atendimento completo. Para o próximo cliente, clique em Nova venda.
            </li>
          )}
        </ol>
      )}
    </section>
  );
}

/** Botão de seguir para a venda: só libera depois de confirmar os passos 1 e 2. */
export function GatedContinue({ flowKey, href, className, children }: { flowKey: string; href: string; className: string; children: React.ReactNode }) {
  const [checks] = useGuide(flowKey);
  if (checks.card && checks.dados)
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span aria-disabled="true" className={cn(className, "cursor-not-allowed opacity-50")}>
        {children}
      </span>
      <span className="text-xs text-muted">Marque os passos 1 e 2 no passo a passo para continuar.</span>
    </span>
  );
}
