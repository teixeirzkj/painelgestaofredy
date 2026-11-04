import { Badge, type Tone } from "./ui";
import { CONTRACT_STATUS, ENTRY_STATUS, FINANCIAL_STATUS, SALE_STATUS, EVENT_STATUS, RESERVATION_STATUS } from "@/lib/constants";

const saleTone: Record<string, Tone> = { ORCAMENTO: "gray", CONFIRMADA: "blue", CONCLUIDA: "green", CANCELADA: "red" };
const entryTone: Record<string, Tone> = { PENDENTE: "amber", PARCIAL: "violet", PAGO: "green", VENCIDO: "red", CANCELADO: "gray" };
const finTone: Record<string, Tone> = { SEM_COBRANCA: "gray", PENDENTE: "amber", PARCIAL: "violet", QUITADO: "green", ATRASADO: "red", CANCELADO: "gray" };
const contractTone: Record<string, Tone> = { NAO_GERADO: "gray", EM_PREPARACAO: "amber", AGUARDANDO_ENVIO: "blue", ENVIADO: "violet", ASSINADO: "green", CANCELADO: "gray" };
const eventTone: Record<string, Tone> = { PENDENTE: "amber", ENTREGUE: "green", SEM_DESTINO: "gray", FALHOU: "red", IGNORADO: "gray" };
const resTone: Record<string, Tone> = { PENDENTE: "amber", CONFIRMADA: "green", CANCELADA: "gray" };

export const SaleStatusBadge = ({ s }: { s: string }) => <Badge tone={saleTone[s] ?? "gray"}>{SALE_STATUS.label(s)}</Badge>;
export const EntryStatusBadge = ({ s, kind = "receivable" }: { s: string; kind?: "receivable" | "payable" }) => (
  <Badge tone={entryTone[s] ?? "gray"}>{s === "PAGO" && kind === "receivable" ? "Recebido" : ENTRY_STATUS.label(s)}</Badge>
);
export const FinancialStatusBadge = ({ s }: { s: string }) => <Badge tone={finTone[s] ?? "gray"}>{FINANCIAL_STATUS.label(s)}</Badge>;
export const ContractStatusBadge = ({ s }: { s: string }) => <Badge tone={contractTone[s] ?? "gray"}>{CONTRACT_STATUS.label(s)}</Badge>;
export const EventStatusBadge = ({ s }: { s: string }) => <Badge tone={eventTone[s] ?? "gray"}>{EVENT_STATUS.label(s)}</Badge>;
export const ReservationStatusBadge = ({ s }: { s: string }) => <Badge tone={resTone[s] ?? "gray"}>{RESERVATION_STATUS.label(s)}</Badge>;
