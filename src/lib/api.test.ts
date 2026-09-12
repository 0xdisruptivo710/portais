import { describe, expect, it, vi } from "vitest";
import { aoPerderSessao, buscarJson, chamarApi, temSessao } from "./api";

function mockFetch(status: number, corpo: unknown = {}) {
  const f = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => corpo });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("chamadas da API", () => {
  it("devolve o corpo quando a resposta e' 2xx", async () => {
    mockFetch(200, { itens: [1, 2] });
    await expect(buscarJson<{ itens: number[] }>("/api/leads")).resolves.toEqual({ itens: [1, 2] });
  });

  it("chama fetch com um argumento so' quando nao ha init", async () => {
    // O contrato que as telas já exercitam: buscarJson("/api/leads") tem que
    // chegar no fetch como fetch("/api/leads"), sem um segundo argumento.
    const f = mockFetch(200, { itens: [] });
    await buscarJson("/api/leads");
    expect(f).toHaveBeenCalledWith("/api/leads");
  });

  it("erro que nao e' 401 continua sendo erro de conteudo, sem derrubar sessao", async () => {
    mockFetch(500, { erro: "config nao gravada" });
    const avisado = vi.fn();
    const cancelar = aoPerderSessao(avisado);

    await expect(buscarJson("/api/config")).rejects.toThrow("config nao gravada");
    expect(avisado).not.toHaveBeenCalled();
    cancelar();
  });
});

describe("401 derruba a sessao", () => {
  it("avisa quem esta ouvindo e nao devolve o 401 como conteudo", async () => {
    mockFetch(401, { erro: "nao autorizado" });
    const avisado = vi.fn();
    const cancelar = aoPerderSessao(avisado);

    await expect(chamarApi("/api/enviar", { method: "POST" })).rejects.toThrow();
    expect(avisado).toHaveBeenCalledTimes(1);
    cancelar();
  });

  it("vale para qualquer endpoint, inclusive os que so' leem", async () => {
    mockFetch(401, { erro: "nao autorizado" });
    const avisado = vi.fn();
    const cancelar = aoPerderSessao(avisado);

    await expect(buscarJson("/api/numeros?dias=30")).rejects.toThrow();
    expect(avisado).toHaveBeenCalled();
    cancelar();
  });

  it("quem cancela a inscricao para de ser avisado", async () => {
    mockFetch(401);
    const avisado = vi.fn();
    aoPerderSessao(avisado)();

    await expect(chamarApi("/api/leads")).rejects.toThrow();
    expect(avisado).not.toHaveBeenCalled();
  });
});

describe("checagem de entrada", () => {
  it("401 aqui e' o primeiro acesso, nao expiracao: nao avisa ninguem", async () => {
    // Este é o laço que não pode existir: a própria checagem de entrada
    // recebe 401 quando não há sessão, e isso é o caminho normal pro login.
    mockFetch(401, { erro: "nao autorizado" });
    const avisado = vi.fn();
    const cancelar = aoPerderSessao(avisado);

    await expect(temSessao()).resolves.toBe(false);
    expect(avisado).not.toHaveBeenCalled();
    cancelar();
  });

  it("200 quer dizer que a sessao esta de pe'", async () => {
    mockFetch(200, {});
    await expect(temSessao()).resolves.toBe(true);
  });

  it("falha de rede vale como sem sessao, nunca como painel liberado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(temSessao()).resolves.toBe(false);
  });
});
