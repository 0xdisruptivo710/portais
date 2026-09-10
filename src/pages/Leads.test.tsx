import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Leads from "./Leads";

describe("tela de leads", () => {
  it("mostra o estado vazio sem parecer erro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itens: [] }) }));
    render(<Leads />);
    expect(await screen.findByText(/nenhum lead/i)).toBeInTheDocument();
  });

  it("lista o lead com portal e veículo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ itens: [{ id: 1, portal: "webmotors", nome: "Fulano", veiculo_texto: "Civic 2020", telefone_exibicao: "+55 (15) 99128-0217", status_ativacao: "dry_run" }] }),
    }));
    render(<Leads />);
    expect(await screen.findByText("Fulano")).toBeInTheDocument();
    expect(screen.getByText(/civic 2020/i)).toBeInTheDocument();
  });
});
