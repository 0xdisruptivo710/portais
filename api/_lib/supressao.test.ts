import { describe, expect, it } from "vitest";
import { decidirSupressao } from "./supressao";

const AGORA = new Date("2026-09-10T12:00:00Z");

describe("decidirSupressao", () => {
  it("libera lead sem contato anterior", () => {
    const r = decidirSupressao({ ultimoContatoEm: null, janelaDias: 30, agora: AGORA, killSwitch: false });
    expect(r.suprimir).toBe(false);
  });

  it("suprime lead contatado dentro da janela", () => {
    const r = decidirSupressao({
      ultimoContatoEm: new Date("2026-09-01T12:00:00Z"),
      janelaDias: 30, agora: AGORA, killSwitch: false,
    });
    expect(r.suprimir).toBe(true);
    expect(r.motivo).toContain("30");
  });

  it("libera lead contatado antes da janela", () => {
    const r = decidirSupressao({
      ultimoContatoEm: new Date("2026-06-01T12:00:00Z"),
      janelaDias: 30, agora: AGORA, killSwitch: false,
    });
    expect(r.suprimir).toBe(false);
  });

  it("suprime tudo quando o kill-switch está ligado", () => {
    const r = decidirSupressao({ ultimoContatoEm: null, janelaDias: 30, agora: AGORA, killSwitch: true });
    expect(r.suprimir).toBe(true);
    expect(r.motivo).toContain("kill");
  });

  it("trata a borda exata da janela como ainda suprimida", () => {
    const r = decidirSupressao({
      ultimoContatoEm: new Date("2026-08-11T12:00:00Z"),
      janelaDias: 30, agora: AGORA, killSwitch: false,
    });
    expect(r.suprimir).toBe(true);
  });
});
