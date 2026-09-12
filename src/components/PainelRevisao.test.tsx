import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import PainelRevisao from "./PainelRevisao";

const EVENTO = {
  id: 9,
  portal: "webmotors",
  assunto: "Novo lead",
  remetente: "webmotors@exemplo.com",
  recebido_em: "2026-09-10T10:00:00Z",
  corpo_texto: "texto simples",
  corpo_html: "<p>corpo</p>",
};

/**
 * A aba Revisão saiu da navegação, mas a fila de segurança não: ela vive
 * dentro da lista de Leads agora. Este painel é o que abre na linha, e ele
 * carrega os dois requisitos que a tela antiga carregava — o e-mail original
 * isolado e o formulário que grava o lead corrigido.
 */
describe("painel de revisão", () => {
  it("renderiza o corpo_html dentro de um iframe totalmente sandboxed, nunca solto no documento", async () => {
    const htmlPerigoso = "<script>window.__hackeado = true;</script><p>Confie em mim</p>";

    const { container } = render(
      <PainelRevisao evento={{ ...EVENTO, corpo_html: htmlPerigoso }} aoCompletar={() => {}} />,
    );

    const iframe = await waitFor(() => {
      const elemento = container.querySelector("iframe");
      if (!elemento) throw new Error("iframe ainda não renderizado");
      return elemento;
    });

    // sandbox="" (sem allow-scripts, allow-same-origin etc.) é o nível mais
    // restritivo: bloqueia script, formulário e acesso à mesma origem.
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.getAttribute("srcdoc")).toBe(htmlPerigoso);

    // Prova negativa: o <script> do e-mail não pode existir como elemento
    // real no documento principal.
    expect(document.body.querySelector("script")).toBeNull();
  });

  it("sem corpo_html, mostra o corpo em texto no mesmo iframe isolado", () => {
    const { container } = render(
      <PainelRevisao evento={{ ...EVENTO, corpo_html: null }} aoCompletar={() => {}} />,
    );

    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toBe("texto simples");
  });

  it("completar manda o evento_id junto dos campos digitados e avisa quem chamou", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 42 }) });
    vi.stubGlobal("fetch", f);
    const aoCompletar = vi.fn();

    render(<PainelRevisao evento={EVENTO} aoCompletar={aoCompletar} />);

    await userEvent.type(screen.getByLabelText(/^nome$/i), "Fulano");
    await userEvent.type(screen.getByLabelText(/^telefone$/i), "15991280217");
    await userEvent.click(screen.getByRole("button", { name: /completar revisão/i }));

    await waitFor(() => expect(aoCompletar).toHaveBeenCalledTimes(1));
    const corpo = JSON.parse(String(f.mock.calls[0][1].body));
    expect(corpo).toMatchObject({ evento_id: 9, nome: "Fulano", telefone: "15991280217" });
    expect(f.mock.calls[0][1].method).toBe("POST");
  });

  it("erro ao gravar fica na tela e não some com o item da fila", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ erro: "banco fora do ar" }) }),
    );
    const aoCompletar = vi.fn();

    render(<PainelRevisao evento={EVENTO} aoCompletar={aoCompletar} />);
    await userEvent.click(screen.getByRole("button", { name: /completar revisão/i }));

    expect(await screen.findByText(/banco fora do ar/i)).toBeInTheDocument();
    expect(aoCompletar).not.toHaveBeenCalled();
  });
});
