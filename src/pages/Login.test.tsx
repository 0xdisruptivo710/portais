import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Login from "./Login";

describe("tela de entrada", () => {
  it("manda a senha para /api/login e avisa quem chamou quando entra", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", f);
    const aoEntrar = vi.fn();

    render(<Login aoEntrar={aoEntrar} />);
    await userEvent.type(screen.getByLabelText(/senha/i), "abre-te-sesamo");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    expect(f).toHaveBeenCalledWith("/api/login", expect.objectContaining({ method: "POST" }));
    expect(aoEntrar).toHaveBeenCalled();
  });

  it("senha errada mostra o aviso e nao deixa entrar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const aoEntrar = vi.fn();

    render(<Login aoEntrar={aoEntrar} />);
    await userEvent.type(screen.getByLabelText(/senha/i), "chute");
    await userEvent.click(screen.getByRole("button", { name: /entrar/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/senha/i);
    expect(aoEntrar).not.toHaveBeenCalled();
  });

  it("quando a sessao expirou, diz isso: senao parece senha errada", () => {
    render(<Login aoEntrar={vi.fn()} expirada />);

    expect(screen.getByText(/expirou/i)).toBeInTheDocument();
  });

  it("no primeiro acesso nao fala em expiracao", () => {
    render(<Login aoEntrar={vi.fn()} />);

    expect(screen.queryByText(/expirou/i)).not.toBeInTheDocument();
  });
});
