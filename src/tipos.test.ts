import { describe, expect, it } from "vitest";
import { PORTAIS, PORTAIS_COM_DADOS } from "./tipos";

describe("catálogo de portais", () => {
  it("tem os nove portais da Malentachi", () => {
    expect(PORTAIS).toHaveLength(9);
  });

  it("marca só os seis que entregam dados no e-mail", () => {
    expect(PORTAIS_COM_DADOS).toEqual([
      "webmotors",
      "icarros",
      "chavesnamao",
      "comprecar",
      "carrosp",
      "usadosbr",
    ]);
    expect(PORTAIS_COM_DADOS).not.toContain("olx");
    expect(PORTAIS_COM_DADOS).not.toContain("mercadolivre");
    // O aviso do newsolx não traz nem anúncio nem pessoa: só diz que existe
    // mensagem não respondida no chat da OLX. Vira lead sem dados, como a OLX.
    expect(PORTAIS_COM_DADOS).not.toContain("olxchat");
  });
});
