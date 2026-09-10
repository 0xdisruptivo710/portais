import { beforeEach, describe, expect, it, vi } from "vitest";
import { podeGastar, montarPrompt } from "./ia";

describe("podeGastar", () => {
  it("libera quando o gasto do dia está abaixo do teto", () => {
    expect(podeGastar({ gastoHojeUsd: 0.5, tetoDiaUsd: 2, tetoEventoUsd: 0.05 })).toBe(true);
  });

  it("bloqueia quando o gasto do dia já bateu no teto", () => {
    expect(podeGastar({ gastoHojeUsd: 2, tetoDiaUsd: 2, tetoEventoUsd: 0.05 })).toBe(false);
  });

  it("bloqueia quando falta margem até para um evento", () => {
    expect(podeGastar({ gastoHojeUsd: 1.98, tetoDiaUsd: 2, tetoEventoUsd: 0.05 })).toBe(false);
  });

  it("bloqueia se o teto vier zerado, em vez de tratar zero como ilimitado", () => {
    expect(podeGastar({ gastoHojeUsd: 0, tetoDiaUsd: 0, tetoEventoUsd: 0.05 })).toBe(false);
  });
});

describe("montarPrompt", () => {
  it("manda o texto do e-mail e pede JSON estrito", () => {
    const p = montarPrompt({ texto: "Nome: Fulano", assunto: "Lead", anexos: [] } as never);
    expect(p).toContain("Nome: Fulano");
    expect(p).toMatch(/json/i);
  });

  it("não inventa campo fora do contrato", () => {
    const p = montarPrompt({ texto: "x", assunto: "y", anexos: [] } as never);
    for (const campo of ["nome", "telefone", "email", "veiculoTexto", "anuncioUrl", "mensagemLead"]) {
      expect(p).toContain(campo);
    }
  });
});
