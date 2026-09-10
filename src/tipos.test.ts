import { describe, expect, it } from "vitest";
import { PORTAIS, PORTAIS_COM_DADOS } from "./tipos";

describe("catálogo de portais", () => {
  it("tem os seis portais da Malentachi", () => {
    expect(PORTAIS).toHaveLength(6);
  });

  it("marca só os quatro que entregam dados no e-mail", () => {
    expect(PORTAIS_COM_DADOS).toEqual([
      "webmotors",
      "icarros",
      "chavesnamao",
      "comprecar",
    ]);
    expect(PORTAIS_COM_DADOS).not.toContain("olx");
    expect(PORTAIS_COM_DADOS).not.toContain("mercadolivre");
  });
});
