import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { decidirAcao, dentroDaJanela } = await import("./ativacao");

const DIA = { horarioInicio: "08:00", horarioFim: "20:00" };
const base = { modo: "real" as const, suprimir: false, motivo: null, ...DIA };

describe("dentroDaJanela", () => {
  it("aceita horário no meio da janela", () => {
    expect(dentroDaJanela(new Date("2026-09-10T13:00:00-03:00"), DIA)).toBe(true);
  });

  it("recusa antes da abertura", () => {
    expect(dentroDaJanela(new Date("2026-09-10T07:59:00-03:00"), DIA)).toBe(false);
  });

  it("recusa depois do fechamento", () => {
    expect(dentroDaJanela(new Date("2026-09-10T20:01:00-03:00"), DIA)).toBe(false);
  });

  it("aceita exatamente na abertura e recusa exatamente no fechamento", () => {
    expect(dentroDaJanela(new Date("2026-09-10T08:00:00-03:00"), DIA)).toBe(true);
    expect(dentroDaJanela(new Date("2026-09-10T20:00:00-03:00"), DIA)).toBe(false);
  });

  it("usa o fuso de São Paulo, não o do servidor", () => {
    // 23h UTC é 20h em SP: fora da janela. Se o servidor rodar em UTC e a
    // função ler a hora local, isso passaria e mandaria mensagem de madrugada.
    expect(dentroDaJanela(new Date("2026-09-10T23:00:00Z"), DIA)).toBe(false);
    expect(dentroDaJanela(new Date("2026-09-10T15:00:00Z"), DIA)).toBe(true);
  });

  it("aceita exatamente na abertura e recusa exatamente no fechamento quando o banco devolve HH:MM:SS", () => {
    // horario_inicio/horario_fim são `time` no Postgres: o PostgREST devolve
    // "08:00:00", não "08:00". Sem truncar para HH:MM antes de comparar, as
    // duas bordas se invertem: "08:00" >= "08:00:00" é false (recusaria a
    // abertura) e "20:00" < "20:00:00" é true (aceitaria o fechamento).
    const DIA_BANCO = { horarioInicio: "08:00:00", horarioFim: "20:00:00" };
    expect(dentroDaJanela(new Date("2026-09-10T08:00:00-03:00"), DIA_BANCO)).toBe(true);
    expect(dentroDaJanela(new Date("2026-09-10T20:00:00-03:00"), DIA_BANCO)).toBe(false);
  });

  it("mantém o mesmo resultado no formato de 5 e de 8 caracteres para o mesmo instante", () => {
    const DIA_BANCO = { horarioInicio: "08:00:00", horarioFim: "20:00:00" };
    for (const iso of [
      "2026-09-10T07:59:00-03:00",
      "2026-09-10T08:00:00-03:00",
      "2026-09-10T13:00:00-03:00",
      "2026-09-10T19:59:00-03:00",
      "2026-09-10T20:00:00-03:00",
      "2026-09-10T20:01:00-03:00",
    ]) {
      const data = new Date(iso);
      expect(dentroDaJanela(data, DIA_BANCO)).toBe(dentroDaJanela(data, DIA));
    }
  });
});

describe("decidirAcao", () => {
  beforeEach(() => fetchMock.mockReset());

  it("em dry_run monta o payload e NAO chama a rede", () => {
    const r = decidirAcao({ ...base, modo: "dry_run" });
    expect(r).toBe("dry_run");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suprimido vence o modo real", () => {
    expect(decidirAcao({ ...base, suprimir: true, motivo: "janela" })).toBe("suprimido");
  });

  it("suprimido vence o dry_run também", () => {
    expect(decidirAcao({ ...base, modo: "dry_run", suprimir: true, motivo: "kill-switch ligado" })).toBe("suprimido");
  });

  it("só libera envio quando o modo é real, sem supressão e dentro da janela", () => {
    expect(decidirAcao({ ...base, agora: new Date("2026-09-10T13:00:00-03:00") })).toBe("enviar");
  });

  it("adia quando está fora da janela, mesmo em modo real", () => {
    expect(decidirAcao({ ...base, agora: new Date("2026-09-10T03:00:00-03:00") })).toBe("adiar");
  });

  it("não adia em dry_run: fora da janela ainda registra o que mandaria", () => {
    expect(decidirAcao({ ...base, modo: "dry_run", agora: new Date("2026-09-10T03:00:00-03:00") })).toBe("dry_run");
  });

  it("trata modo desconhecido como dry_run, nunca como real", () => {
    expect(decidirAcao({ ...base, modo: "qualquer-coisa" as never })).toBe("dry_run");
  });
});
