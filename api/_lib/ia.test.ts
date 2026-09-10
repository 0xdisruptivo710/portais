import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extrairComIa, podeGastar, montarPrompt } from "./ia";

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

describe("extrairComIa", () => {
  const EMAIL = {
    messageId: "<x@webmotors.com.br>",
    remetente: "leads@webmotors.com.br",
    assunto: "Novo lead",
    recebidoEm: "2026-09-10T12:00:00.000Z",
    texto: "corpo",
    html: "<p>corpo</p>",
    anexos: [],
  };
  const ORCAMENTO = { gastoHojeUsd: 0, tetoDiaUsd: 2, tetoEventoUsd: 0.05 };

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "chave-de-teste");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Falha de rede: o fetch nunca completou, então nada foi cobrado pela IA.
  it("resolve com lead nulo e custo zero quando o fetch rejeita (falha de rede)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const r = await extrairComIa(EMAIL as never, ORCAMENTO);

    expect(r).toEqual({ lead: null, custoUsd: 0 });
  });

  // Resposta chegou (ok:true) mas o corpo não é JSON válido: a chamada foi
  // cobrada mesmo sem dado utilizável, diferente da falha de rede acima.
  it("resolve com lead nulo e custo cobrado quando a resposta não é JSON válido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error("corpo nao e json")),
      }),
    );

    const r = await extrairComIa(EMAIL as never, ORCAMENTO);

    expect(r.lead).toBeNull();
    expect(r.custoUsd).toBeGreaterThan(0);
  });
});
