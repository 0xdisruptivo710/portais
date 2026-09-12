import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const CHAVE = "chave-do-embed";

/**
 * O AIOS embeda o painel como `<iframe src=".../?k=<EMBED_TOKEN>">`. A chave
 * fica no src, então ela continua lá depois de um reload: é isso que faz o
 * fluxo se refazer sozinho sem ninguém digitar nada.
 */
function chaveNaUrl(chave: string | null) {
  window.history.replaceState({}, "", chave === null ? "/" : `/?k=${chave}`);
}

function mockApi(responder: (url: string, init?: RequestInit) => number) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    const status = responder(url, init);
    return { ok: status < 400, status, json: async () => ({ itens: [] }) };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function trocasDeChave(f: ReturnType<typeof vi.fn>): unknown[] {
  return f.mock.calls.filter((chamada) => chamada[0] === "/api/sessao");
}

beforeEach(() => {
  chaveNaUrl(null);
});

describe("entrada pela chave do embed", () => {
  it("chave correta na URL abre a sessao e mostra o painel", async () => {
    chaveNaUrl(CHAVE);
    const f = mockApi((url, init) => {
      if (url !== "/api/sessao") return 200;
      const corpo = JSON.parse(String(init?.body ?? "{}")) as { chave?: string };
      return corpo.chave === CHAVE ? 204 : 401;
    });

    render(<App />);

    expect(await screen.findByRole("link", { name: /leads/i })).toBeInTheDocument();
    expect(f).toHaveBeenCalledWith("/api/sessao", expect.objectContaining({ method: "POST" }));
  });

  it("chave errada e' recusada: o painel nao monta", async () => {
    chaveNaUrl("chave-errada");
    mockApi((url) => (url === "/api/sessao" ? 401 : 200));

    render(<App />);

    expect(await screen.findByText(/acesso nao autorizado|acesso não autorizado/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /leads/i })).not.toBeInTheDocument();
  });

  it("sem chave e sem sessao: acesso negado, sem formulario e sem campo de senha", async () => {
    // Mensagem neutra: a mesma para chave ausente e chave errada, e sem
    // pedir nada. O usuário final do AIOS não tem senha para digitar.
    mockApi(() => 401);

    render(<App />);

    await screen.findByText(/acesso nao autorizado|acesso não autorizado/i);
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("sem chave, mas com sessao ainda viva, o painel abre", async () => {
    mockApi(() => 200);

    render(<App />);

    expect(await screen.findByRole("link", { name: /leads/i })).toBeInTheDocument();
  });
});

/**
 * A aba saiu a pedido do operador. A fila de revisao nao saiu: ela vive
 * dentro da lista de Leads (ver pages/Leads.tsx). O que este teste garante e'
 * so' que a navegacao nao oferece mais a tela separada.
 */
describe("navegacao sem a aba Revisao", () => {
  it("as abas sao Leads, Numeros e Configuracao", async () => {
    mockApi(() => 200);

    render(<App />);

    await screen.findByRole("link", { name: /leads/i });
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual([
      "Leads",
      "Números",
      "Configuração",
    ]);
  });

  it("nao existe mais link para Revisao", async () => {
    mockApi(() => 200);

    render(<App />);

    await screen.findByRole("link", { name: /leads/i });
    expect(screen.queryByRole("link", { name: /revis/i })).not.toBeInTheDocument();
  });
});

describe("sessao que cai com o painel aberto", () => {
  it("com a chave na URL, refaz a sessao uma vez e o operador nao ve nada", async () => {
    chaveNaUrl(CHAVE);
    let chamadasDoPainel = 0;
    const f = mockApi((url) => {
      if (url === "/api/sessao") return 204;
      // A primeira onda de chamadas pega o cookie ja' expirado; depois da
      // troca, o painel volta a ser atendido.
      chamadasDoPainel += 1;
      return chamadasDoPainel <= 2 ? 401 : 200;
    });

    render(<App />);
    await screen.findByRole("link", { name: /leads/i });
    await waitFor(() => expect(trocasDeChave(f)).toHaveLength(2));

    expect(screen.getByRole("link", { name: /leads/i })).toBeInTheDocument();
    expect(screen.queryByText(/acesso nao autorizado|acesso não autorizado/i)).not.toBeInTheDocument();
  });

  it("sem a chave na URL, 401 derruba a sessao e mostra acesso negado", async () => {
    let chamadas = 0;
    mockApi(() => {
      chamadas += 1;
      return chamadas === 1 ? 200 : 401;
    });

    render(<App />);

    expect(await screen.findByText(/acesso nao autorizado|acesso não autorizado/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /leads/i })).not.toBeInTheDocument();
  });

  it("401 numa tela nao deixa as outras montadas com erro de conteudo", async () => {
    let chamadas = 0;
    mockApi(() => {
      chamadas += 1;
      return chamadas === 1 ? 200 : 401;
    });

    render(<App />);

    await screen.findByText(/acesso nao autorizado|acesso não autorizado/i);
    expect(screen.queryByRole("link", { name: /revis/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/nao autorizado:/i)).not.toBeInTheDocument();
  });

  it("renovacao que falha nao vira laco: uma tentativa so', depois acesso negado", async () => {
    chaveNaUrl(CHAVE);
    let trocas = 0;
    const f = mockApi((url) => {
      if (url === "/api/sessao") {
        trocas += 1;
        return trocas === 1 ? 204 : 401;
      }
      return 401;
    });

    render(<App />);

    expect(await screen.findByText(/acesso nao autorizado|acesso não autorizado/i)).toBeInTheDocument();
    expect(trocasDeChave(f)).toHaveLength(2);
  });
});
