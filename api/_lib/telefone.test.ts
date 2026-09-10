import { describe, expect, it } from "vitest";
import { paraE164, paraExibicao, paraPipeWts } from "./telefone";

describe("paraE164", () => {
  it("aceita celular com máscara e DDD", () => {
    expect(paraE164("(15) 99128-0217")).toBe("5515991280217");
  });

  it("aceita celular já com +55", () => {
    expect(paraE164("+55 (15) 99128-0217")).toBe("5515991280217");
  });

  it("aceita celular só em dígitos, sem 55", () => {
    expect(paraE164("15991280217")).toBe("5515991280217");
  });

  it("aceita celular já canônico e devolve igual", () => {
    expect(paraE164("5515991280217")).toBe("5515991280217");
  });

  it("aceita telefone fixo de dez dígitos", () => {
    expect(paraE164("(15) 4141-2625")).toBe("551541412625");
  });

  it("descarta o zero de operadora na frente", () => {
    expect(paraE164("015 99128-0217")).toBe("5515991280217");
  });

  it("NÃO inventa nono dígito em número de doze dígitos com 55", () => {
    // 55 + DDD + 8 dígitos. Pode ser fixo ou celular antigo.
    // Inventar o 9 é como se corrompe base inteira. Preserva como veio.
    expect(paraE164("551541412625")).toBe("551541412625");
  });

  it("recusa número sem DDD", () => {
    expect(paraE164("99128-0217")).toBeNull();
  });

  it("recusa lixo, vazio e nulo", () => {
    expect(paraE164("não informado")).toBeNull();
    expect(paraE164("")).toBeNull();
    expect(paraE164(null)).toBeNull();
  });

  it("recusa número longo demais para ser brasileiro", () => {
    expect(paraE164("5515991280217999")).toBeNull();
  });

  it("recusa DDD inexistente", () => {
    expect(paraE164("(00) 99128-0217")).toBeNull();
    expect(paraE164("(10) 99128-0217")).toBeNull();
  });
});

describe("paraExibicao", () => {
  it("formata celular no padrão da base", () => {
    expect(paraExibicao("5515991280217")).toBe("+55 (15) 99128-0217");
  });

  it("formata fixo", () => {
    expect(paraExibicao("551541412625")).toBe("+55 (15) 4141-2625");
  });

  it("devolve null para null", () => {
    expect(paraExibicao(null)).toBeNull();
  });
});

describe("paraPipeWts", () => {
  it("monta o formato pipe que o WTS exige", () => {
    expect(paraPipeWts("5515991280217")).toBe("+55|15991280217");
  });
});
