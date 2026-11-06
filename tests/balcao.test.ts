import { describe, expect, it } from "vitest";
import { DONE_STEP, flowSteps } from "@/server/services/balcao";

const base = { cardDone: true, dataChecked: true, docsDone: true, contractSent: false, finishedAt: null, clientComplete: true, saleStatus: null as string | null, contractStatus: null as string | null, canContract: true };

describe("etapas do atendimento da venda rápida", () => {
  it("para no cliente enquanto o cadastro estiver incompleto, mesmo conferido", () => {
    expect(flowSteps({ ...base, clientComplete: false }).current).toBe(2);
  });
  it("documentos é etapa própria: só passa quando o atendente segue ou pula", () => {
    expect(flowSteps({ ...base, docsDone: false }).current).toBe(3);
  });
  it("venda em rascunho continua na etapa da venda", () => {
    expect(flowSteps({ ...base, saleStatus: "ORCAMENTO" }).current).toBe(4);
    expect(flowSteps({ ...base, saleStatus: "CONFIRMADA", contractStatus: "RASCUNHO" }).current).toBe(5);
  });
  it("contrato emitido vai para o envio; enviado pela assinatura online pula a confirmação manual", () => {
    expect(flowSteps({ ...base, saleStatus: "CONFIRMADA", contractStatus: "AGUARDANDO_ENVIO" }).current).toBe(6);
    expect(flowSteps({ ...base, saleStatus: "CONFIRMADA", contractStatus: "ENVIADO" }).current).toBe(7);
    expect(flowSteps({ ...base, saleStatus: "CONFIRMADA", contractStatus: "AGUARDANDO_ENVIO", contractSent: true }).current).toBe(7);
  });
  it("venda alterada depois da emissão: volta para emitir o contrato de novo", () => {
    expect(flowSteps({ ...base, saleStatus: "CONFIRMADA", contractStatus: "AGUARDANDO_ENVIO", contractOutdated: true }).current).toBe(5);
  });
  it("sem permissão de contrato, as etapas 5 e 6 não travam", () => {
    expect(flowSteps({ ...base, canContract: false, saleStatus: "CONFIRMADA" }).current).toBe(7);
  });
  it("concluído", () => {
    expect(flowSteps({ ...base, saleStatus: "CONFIRMADA", contractStatus: "ASSINADO", finishedAt: new Date() }).current).toBe(DONE_STEP);
  });
});
