import { describe, expect, it } from "vitest";
import { casarComEstoque } from "./estoque";

const ESTOQUE = [
  { id: 1, marca: "Honda", modelo: "Civic", ano: "2020", link: "https://loja.com/civic-2020" },
  { id: 2, marca: "Volkswagen", modelo: "T-Cross", ano: "2022", link: "https://loja.com/tcross" },
  { id: 3, marca: "Honda", modelo: "Civic", ano: "2018", link: null },
];

describe("casarComEstoque", () => {
  it("casa pelo link exato do anúncio antes de qualquer outra coisa", () => {
    expect(casarComEstoque("carro qualquer", "https://loja.com/tcross", ESTOQUE)).toBe(2);
  });

  it("casa por marca, modelo e ano quando não há link", () => {
    expect(casarComEstoque("Honda Civic EXL 2.0 2020", null, ESTOQUE)).toBe(1);
  });

  it("desempata pelo ano quando marca e modelo repetem", () => {
    expect(casarComEstoque("Honda Civic 2018", null, ESTOQUE)).toBe(3);
  });

  it("casa sem o ano quando o texto não traz ano", () => {
    expect(casarComEstoque("Volkswagen T-Cross", null, ESTOQUE)).toBe(2);
  });

  it("aguenta hífen e caixa diferente no modelo", () => {
    expect(casarComEstoque("VOLKSWAGEN t cross 2022", null, ESTOQUE)).toBe(2);
  });

  it("devolve null quando o carro não está no estoque", () => {
    expect(casarComEstoque("Fiat Uno 2010", null, ESTOQUE)).toBeNull();
  });

  it("devolve null para texto vazio, em vez de casar com o primeiro", () => {
    expect(casarComEstoque(null, null, ESTOQUE)).toBeNull();
  });
});
