import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

function mockFetch(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => ({ itens: [] }) }),
  );
}

/**
 * Roteia por URL: a checagem de entrada bate em /api/config, e as telas do
 * painel batem nos outros endpoints. Separar os dois é o que permite montar
 * o painel com sessão viva e depois deixar a sessão morrer debaixo dele.
 */
function mockFetchPorUrl(statusDe: (url: string) => number) {
  const f = vi.fn(async (url: string) => {
    const status = statusDe(url);
    return { ok: status < 400, status, json: async () => ({ itens: [] }) };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

/** Sessão viva na entrada, morta em todo o resto: o cookie expirou com a aba aberta. */
function mockSessaoQueExpira() {
  return mockFetchPorUrl((url) => (url.startsWith("/api/config") ? 200 : 401));
}

describe("porta de entrada do painel", () => {
  it("sem sessao (401), mostra o login e nao o painel", async () => {
    mockFetch(401);

    render(<App />);

    expect(await screen.findByLabelText(/senha/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /leads/i })).not.toBeInTheDocument();
  });

  it("no primeiro acesso, o login nao acusa expiracao", async () => {
    // Uma tela de login que fala em sessão expirada para quem nunca entrou
    // faz o operador procurar um problema que não existe.
    mockFetch(401);

    render(<App />);

    await screen.findByLabelText(/senha/i);
    expect(screen.queryByText(/expirou/i)).not.toBeInTheDocument();
  });

  it("com sessao, mostra o painel", async () => {
    mockFetch(200);

    render(<App />);

    expect(await screen.findByRole("link", { name: /leads/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
  });
});

describe("sessao que expira com o painel aberto", () => {
  it("401 de qualquer endpoint volta pro login dizendo que a sessao expirou", async () => {
    mockSessaoQueExpira();

    render(<App />);

    expect(await screen.findByLabelText(/senha/i)).toBeInTheDocument();
    expect(screen.getByText(/expirou/i)).toBeInTheDocument();
  });

  it("401 numa tela nao deixa as outras montadas com erro de conteudo", async () => {
    mockSessaoQueExpira();

    render(<App />);

    await screen.findByLabelText(/senha/i);
    expect(screen.queryByRole("link", { name: /leads/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /revis/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/nao autorizado/i)).not.toBeInTheDocument();
  });
});
