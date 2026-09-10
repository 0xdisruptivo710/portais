import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buscarContatoPorTelefone, criarCard, montarEnvio, montarTexto, wtsRequest } from "./wts";

describe("montarEnvio", () => {
  it("monta o corpo no contrato do WTS", () => {
    const r = montarEnvio({ texto: "Oi", from: "(15) 4141-2625", e164: "5511912345678" });
    expect(r).toEqual({
      body: { text: "Oi" },
      from: "(15) 4141-2625",
      to: "+55|11912345678",
    });
  });
});

describe("montarTexto", () => {
  it("substitui os três placeholders", () => {
    const t = montarTexto("Oi {nome}, vi seu interesse no {veiculo} pelo {portal}.", {
      nome: "Fulano", veiculo: "Civic 2020", portal: "Webmotors",
    });
    expect(t).toBe("Oi Fulano, vi seu interesse no Civic 2020 pelo Webmotors.");
  });

  it("não deixa placeholder órfão quando falta o dado", () => {
    const t = montarTexto("Oi {nome}, vi seu interesse no {veiculo}.", { nome: "Fulano", veiculo: null, portal: null });
    expect(t).not.toContain("{");
    expect(t).toContain("Fulano");
  });

  it("não usa travessão nem asterisco", () => {
    const t = montarTexto("Oi {nome}, tudo bem?", { nome: "Fulano", veiculo: null, portal: null });
    expect(t).not.toContain("—");
    expect(t).not.toContain("*");
  });
});

describe("wtsRequest", () => {
  beforeEach(() => {
    vi.stubEnv("WTS_TOKEN", "token-de-teste");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("manda o header authorization sem a palavra Bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue("") });
    vi.stubGlobal("fetch", fetchMock);

    await wtsRequest("GET", "/qualquer");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.wts.chat/qualquer");
    expect(init.headers.authorization).toBe("token-de-teste");
    expect(init.headers.authorization).not.toContain("Bearer");
  });

  it("estoura sem WTS_TOKEN configurado, em vez de mandar a requisição sem token", async () => {
    vi.stubEnv("WTS_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(wtsRequest("GET", "/qualquer")).rejects.toThrow("WTS_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("estoura com o status e o corpo quando a resposta não é ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: vi.fn().mockResolvedValue("unauthorized") }),
    );

    await expect(wtsRequest("GET", "/qualquer")).rejects.toThrow(/401/);
  });

  it("devolve null quando o corpo da resposta vem vazio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue("") }));

    expect(await wtsRequest("GET", "/qualquer")).toBeNull();
  });

  it("faz o parse do corpo quando a resposta vem em json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('{"a":1}') }),
    );

    expect(await wtsRequest("GET", "/qualquer")).toEqual({ a: 1 });
  });
});

describe("buscarContatoPorTelefone", () => {
  beforeEach(() => {
    vi.stubEnv("WTS_TOKEN", "token-de-teste");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("devolve o contato quando a busca acha", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: vi.fn().mockResolvedValue('{"id":"abc"}') }),
    );

    expect(await buscarContatoPorTelefone("5511912345678")).toEqual({ id: "abc" });
  });

  it("devolve null quando a rota responde 500 (contrato: contato inexistente não é 404)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue("erro") }),
    );

    expect(await buscarContatoPorTelefone("5511912345678")).toBeNull();
  });

  it("propaga qualquer outro erro, sem confundir com contato inexistente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: vi.fn().mockResolvedValue("unauthorized") }),
    );

    await expect(buscarContatoPorTelefone("5511912345678")).rejects.toThrow();
  });
});

describe("criarCard", () => {
  beforeEach(() => {
    vi.stubEnv("WTS_TOKEN", "token-de-teste");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("cria o card com contactIds em array e confere que o contato entrou", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('{"id":"card1","contactIds":["c1"]}'),
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await criarCard({ panelId: "panel1", stepId: "step1", title: "Fulano", contactId: "c1" });

    expect(r).toEqual({ id: "card1", contactIds: ["c1"] });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      panelId: "panel1",
      stepId: "step1",
      title: "Fulano",
      contactIds: ["c1"],
    });
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("estoura quando contactIds volta vazio, sinal de que o contato não entrou no card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue('{"id":"card1","contactIds":[]}'),
      }),
    );

    await expect(
      criarCard({ panelId: "panel1", stepId: "step1", title: "Fulano", contactId: "c1" }),
    ).rejects.toThrow();
  });

  it("estoura sem title, refletindo o 500 que a API devolve nesse caso", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue("title obrigatorio") }),
    );

    await expect(
      criarCard({ panelId: "panel1", stepId: "step1", title: "", contactId: "c1" }),
    ).rejects.toThrow(/500/);
  });
});
