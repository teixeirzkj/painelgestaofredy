/** Textos dos alertas do monitor de voos (Central da Viagem). */
export const ALERT_LABEL: Record<string, string> = {
  CANCELADO: "Cancelado pela companhia",
  POSSIVEL_CANCELAMENTO: "Possível cancelamento",
  ATRASO: "Atrasado",
  HORARIO: "Horário mudou na companhia",
  DESVIADO: "Desviado",
};

const hhmm = (v?: string | null) => (v ? v.slice(11, 16) : "");
const ddmm = (v?: string | null) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}` : "");

/** Mensagem pronta para o cliente (a equipe revisa antes de mandar). */
export function clientMessage(a: { kind: string; flight: string; departureAt: string; newTimeAt: string | null }, clientName: string, agency: string) {
  const nome = clientName.split(/\s+/)[0];
  const voo = `${a.flight} do dia ${ddmm(a.departureAt)}`;
  switch (a.kind) {
    case "CANCELADO":
      return `Oi, ${nome}! O voo ${voo} foi cancelado pela companhia aérea. Já estamos cuidando da remarcação e te avisamos em instantes. — ${agency}`;
    case "POSSIVEL_CANCELAMENTO":
      return `Oi, ${nome}! A companhia sinalizou uma possível alteração no voo ${voo}. Estamos confirmando e te avisamos assim que tivermos a resposta. — ${agency}`;
    case "ATRASO":
      return `Oi, ${nome}! O voo ${voo} está atrasado${a.newTimeAt ? ` e a nova previsão de saída é ${hhmm(a.newTimeAt)}` : ""}. Seguimos acompanhando e qualquer novidade te avisamos. — ${agency}`;
    case "HORARIO":
      return `Oi, ${nome}! A companhia alterou o horário do voo ${voo}: agora sai às ${hhmm(a.newTimeAt)} (antes ${hhmm(a.departureAt)}). Se precisar de ajuda com a mudança, estamos aqui. — ${agency}`;
    case "DESVIADO":
      return `Oi, ${nome}! O voo ${voo} precisou ser desviado. Estamos acompanhando e já te passamos as orientações. — ${agency}`;
    default:
      return `Oi, ${nome}! Houve uma alteração no voo ${voo}. Estamos acompanhando. — ${agency}`;
  }
}
