import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Config from "./Config";

const CFG = {
  texto_boas_vindas: "Oi {nome}",
  janela_supressao_dias: 30,
  horario_inicio: "08:00",
  horario_fim: "20:00",
  modo_envio: "dry_run",
  kill_switch: false,
};

function mockFetch(cfg = CFG) {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => cfg });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("tela de configuração", () => {
  it("mostra o modo de envio corrente com destaque", async () => {
    mockFetch();
    render(<Config />);
    expect(await screen.findByText(/dry.run/i)).toBeInTheDocument();
  });

  it("salva o texto de boas-vindas sem exigir deploy", async () => {
    const f = mockFetch();
    render(<Config />);
    const campo = await screen.findByLabelText(/boas-vindas/i);
    await userEvent.clear(campo);
    await userEvent.type(campo, "Oi {nome}, tudo bem?");
    await userEvent.click(screen.getByRole("button", { name: /salvar/i }));
    expect(f).toHaveBeenCalledWith("/api/config", expect.objectContaining({ method: "PUT" }));
  });

  it("exige confirmação escrita para ligar o envio real", async () => {
    mockFetch();
    render(<Config />);
    await userEvent.click(await screen.findByLabelText(/envio real/i));
    expect(screen.getByRole("button", { name: /salvar/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/confirma/i), "ENVIAR DE VERDADE");
    expect(screen.getByRole("button", { name: /salvar/i })).toBeEnabled();
  });

  it("o kill-switch é de um clique só, sem confirmação", async () => {
    const f = mockFetch();
    render(<Config />);
    await userEvent.click(await screen.findByRole("button", { name: /parar tudo/i }));
    expect(f).toHaveBeenCalledWith("/api/config", expect.objectContaining({ method: "PUT" }));
  });
});
