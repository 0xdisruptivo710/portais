import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("busca sem filtro de portal na carga inicial", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itens: [] }) });
    vi.stubGlobal("fetch", f);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);
    expect(f).toHaveBeenCalledWith("/api/leads");
  });

  // O endpoint /api/leads já aceita ?portal= nativamente (ver api/leads.ts);
  // filtrar em memória sobre os 50 mais recentes escondia leads de um portal
  // que não estivessem nessa primeira página. O filtro tem que ir pra query.
  it("trocar o filtro de portal refaz a busca no servidor, com ?portal=", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itens: [] }) });
    vi.stubGlobal("fetch", f);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);
    f.mockClear();

    await userEvent.selectOptions(screen.getByLabelText(/portal/i), "webmotors");

    expect(f).toHaveBeenCalledWith("/api/leads?portal=webmotors");
  });

  it("voltar o filtro para 'Todos' refaz a busca sem o query param", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itens: [] }) });
    vi.stubGlobal("fetch", f);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);

    await userEvent.selectOptions(screen.getByLabelText(/portal/i), "webmotors");
    f.mockClear();
    await userEvent.selectOptions(screen.getByLabelText(/portal/i), "");

    expect(f).toHaveBeenCalledWith("/api/leads");
  });
});
