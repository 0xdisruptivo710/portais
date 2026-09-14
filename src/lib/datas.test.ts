import { describe, expect, it } from "vitest";
import { dataAbsolutaLead, tempoDesdeLead } from "./datas";

// Meio da tarde em Sao Paulo (UTC-3), no dia 14/09/2026.
const AGORA = new Date("2026-09-14T18:00:00Z");

describe("dataAbsolutaLead", () => {
  it("mostra dia e mes, sem ano, quando o lead e do mesmo ano de agora", () => {
    expect(dataAbsolutaLead("2026-09-14T10:00:00Z", AGORA)).toBe("14/09");
  });

  it("inclui o ano quando o lead e de um ano anterior ao de agora", () => {
    expect(dataAbsolutaLead("2025-12-20T10:00:00Z", AGORA)).toBe("20/12/25");
  });

  it("sem data, devolve o rotulo proprio, nunca string vazia ou NaN", () => {
    expect(dataAbsolutaLead(null, AGORA)).toBe("sem data");
    expect(dataAbsolutaLead("isso nao e uma data", AGORA)).toBe("sem data");
  });

  // A guarda do fuso: 02:30 UTC do dia 15 ainda e 23:30 do dia 14 em Sao
  // Paulo (UTC-3). Sem fixar o fuso, esse lead apareceria um dia adiantado.
  it("usa o fuso de Sao Paulo, nao o fuso UTC do servidor", () => {
    expect(dataAbsolutaLead("2026-09-15T02:30:00Z", AGORA)).toBe("14/09");
  });
});

describe("tempoDesdeLead", () => {
  it("hoje", () => {
    expect(tempoDesdeLead("2026-09-14T08:00:00Z", AGORA)).toBe("hoje");
  });

  it("ontem", () => {
    expect(tempoDesdeLead("2026-09-13T08:00:00Z", AGORA)).toBe("ontem");
  });

  it("ha N dias, abaixo de uma semana", () => {
    expect(tempoDesdeLead("2026-09-10T08:00:00Z", AGORA)).toBe("há 4 dias");
  });

  it("ha N semanas, entre uma semana e um mes", () => {
    expect(tempoDesdeLead("2026-08-25T08:00:00Z", AGORA)).toBe("há 3 semanas");
  });

  // O caso real do resgate da Lixeira: e-mail de julho, gravado no banco
  // hoje. A conta tem que usar capturado_em (a data do e-mail), nao a data
  // em que a linha foi inserida, senao o lead antigo parece ter chegado agora.
  it("ha N meses, acima de um mes", () => {
    expect(tempoDesdeLead("2026-07-10T08:00:00Z", AGORA)).toBe("há 2 meses");
  });

  it("sem data, devolve o rotulo proprio", () => {
    expect(tempoDesdeLead(null, AGORA)).toBe("sem data");
    expect(tempoDesdeLead("isso nao e uma data", AGORA)).toBe("sem data");
  });
});
