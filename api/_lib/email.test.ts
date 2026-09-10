import { describe, expect, it } from "vitest";
import { htmlParaTexto } from "./email";

describe("htmlParaTexto", () => {
  it("transforma quebra de linha em texto", () => {
    expect(htmlParaTexto("<p>Oi</p><p>Tudo bem</p>")).toBe("Oi\n\nTudo bem");
  });

  it("descarta style e script", () => {
    expect(htmlParaTexto("<style>a{color:red}</style><p>Oi</p>")).toBe("Oi");
  });

  it("resolve entidades comuns", () => {
    expect(htmlParaTexto("<p>Jo&amp;o&nbsp;Silva</p>")).toBe("Jo&o Silva");
  });

  it("aguenta html vazio", () => {
    expect(htmlParaTexto("")).toBe("");
  });
});
