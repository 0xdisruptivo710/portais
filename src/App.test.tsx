import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

function mockFetch(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => ({ itens: [] }) }),
  );
}

describe("porta de entrada do painel", () => {
  it("sem sessao (401), mostra o login e nao o painel", async () => {
    mockFetch(401);

    render(<App />);

    expect(await screen.findByLabelText(/senha/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /leads/i })).not.toBeInTheDocument();
  });

  it("com sessao, mostra o painel", async () => {
    mockFetch(200);

    render(<App />);

    expect(await screen.findByRole("link", { name: /leads/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
  });
});
