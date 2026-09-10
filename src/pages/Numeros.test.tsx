import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Numeros from "./Numeros";

function mockFetch(resposta: unknown) {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => resposta });
  vi.stubGlobal("fetch", f);
  return f;
}

const RESPOSTA_BASE = {
  dias: 30,
  itens: [
    {
      portal: "webmotors",
      total: 4,
      taxa_identificacao: 0.5,
      revisao: 1,
      tempo_mediano_primeiro_contato_min: 45,
    },
    {
      portal: "olx",
      total: 0,
      taxa_identificacao: 0,
      revisao: 0,
      tempo_mediano_primeiro_contato_min: null,
    },
  ],
  serie_diaria: [{ data: "2026-09-09", portal: "webmotors", total: 2 }],
};

describe("tela de números", () => {
  it("mostra o tempo até o primeiro contato por portal", async () => {
    mockFetch(RESPOSTA_BASE);
    render(<Numeros />);

    expect(await screen.findByText(/45min/)).toBeInTheDocument();
  });

  it("portal sem lead contatado ainda não mostra NaN nem quebra a tela", async () => {
    mockFetch(RESPOSTA_BASE);
    render(<Numeros />);

    expect(await screen.findByText(/sem contato ainda/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("mostra a série diária de leads por portal", async () => {
    mockFetch(RESPOSTA_BASE);
    render(<Numeros />);

    expect(await screen.findByText("2026-09-09")).toBeInTheDocument();
  });

  it("período sem nenhum lead mostra aviso, não tabela vazia", async () => {
    mockFetch({ ...RESPOSTA_BASE, serie_diaria: [] });
    render(<Numeros />);

    expect(await screen.findByText(/nenhum lead capturado/i)).toBeInTheDocument();
  });

  it("trocar a janela de dias refaz a busca com o novo ?dias=", async () => {
    const f = mockFetch(RESPOSTA_BASE);
    render(<Numeros />);

    await screen.findByText(/45min/);
    f.mockClear();

    await userEvent.selectOptions(screen.getByLabelText(/janela/i), "90");

    expect(f).toHaveBeenCalledWith("/api/numeros?dias=90");
  });
});
