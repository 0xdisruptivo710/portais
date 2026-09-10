import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Revisao from "./Revisao";

/**
 * Este é o requisito de segurança do brief: corpo_html vem de um e-mail de
 * terceiro (o portal), não é confiável, e nunca pode ser renderizado solto
 * no documento principal. Só um <iframe sandbox> isola o script embutido.
 */
describe("tela de revisão", () => {
  it("renderiza o corpo_html dentro de um iframe totalmente sandboxed, nunca solto no documento", async () => {
    const htmlPerigoso = "<script>window.__hackeado = true;</script><p>Confie em mim</p>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          itens: [
            {
              id: 9,
              portal: "webmotors",
              assunto: "Novo lead",
              remetente: "webmotors@exemplo.com",
              recebido_em: "2026-09-10T10:00:00Z",
              corpo_texto: "texto simples",
              corpo_html: htmlPerigoso,
            },
          ],
        }),
      }),
    );

    const { container } = render(<Revisao />);

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
    // real no documento principal (dentro de um atributo, "<script>" é só
    // texto de valor, não markup; quem o interpretaria como elemento é o
    // documento isolado do iframe, e o sandbox="" impede ele de rodar).
    expect(document.body.querySelector("script")).toBeNull();
  });
});
