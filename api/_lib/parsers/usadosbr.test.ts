import { describe, expect, it } from "vitest";
import { parserDoPortal } from "./index.js";
import type { EmailCru } from "../../../src/tipos.js";

/**
 * O e-mail do Usadosbr, com a estrutura do e-mail real e os dados trocados.
 * O `.eml` de verdade fica em fixtures/usadosbr/ (gitignored: nome, telefone
 * e e-mail de pessoa real).
 *
 * Três particularidades do template, as três presentes no e-mail real:
 * 1. O `text/plain` vem VAZIO. Tudo mora no HTML, como no Chaves na Mão.
 * 2. A versão do carro é quebrada em duas linhas ("2021" e "/2022"), e só a
 *    primeira metade tem o ano de fabricação.
 * 3. O primeiro link do corpo é o painel do anunciante
 *    (console.usadosbr.com/central/propostas/...), que não casa com estoque
 *    nenhum: o link do anúncio vem depois.
 */
const HTML = `
<table>
  <tr><td><h2>Você recebeu uma mensagem</h2></td></tr>
  <tr><td><p><strong>Nome:</strong> Fulano de Tal</p></td></tr>
  <tr><td><p><strong>Tel:</strong> (15) 90000-0000</p></td></tr>
  <tr><td><p><strong>E-mail:</strong> fulano@exemplo.com</p></td></tr>
  <tr><td><p><strong>Mensagem:</strong> Olá, tenho interesse no veículo, favor entrar em contato. Obrigado!</p></td></tr>
  <tr><td><a href="https://console.usadosbr.com/central/propostas/recebidas/5420714">VISUALIZAR</a></td></tr>
  <tr><td>
    <p><strong>Loja:</strong> Malentachi Veículos</p>
    <p><strong>Veículo: </strong>Fiat Argo</p>
    <p><strong>Versão: </strong>1.0 Prata 2021
      /2022</p>
    <p><strong>Valor: </strong>R$ 55.900,00</p>
    <p><strong>Placa: </strong><span>ABC-1D23</span></p>
    <p><strong>Cód: </strong> 18812694</p>
  </td></tr>
  <tr><td><a href="https://www.usadosbr.com/carros-e-utilitarios/fiat/argo/1-0-504/2022-prata-sorocaba-sao-paulo-1844">visualizar</a></td></tr>
  <tr><td><a href="https://ajuda.usadosbr.com/support/home">ajuda.usadosbr.com</a></td></tr>
</table>`;

function email(over: Partial<EmailCru> = {}): EmailCru {
  return {
    messageId: "<usadosbr@exemplo.com>",
    remetente: "Usadosbr <propostas@usadosbr.com>",
    assunto: "Usadosbr :: Proposta Recebida",
    recebidoEm: "2026-09-12T00:23:24.000Z",
    texto: "",
    html: HTML,
    anexos: [],
    ...over,
  };
}

const parser = parserDoPortal("usadosbr");

describe("parser do Usadosbr", () => {
  it("está registrado", () => {
    expect(parser).not.toBeNull();
  });

  it("lê nome, telefone, e-mail, mensagem e carro do HTML", () => {
    expect(parser!(email())).toEqual({
      nome: "Fulano de Tal",
      telefone: "(15) 90000-0000",
      email: "fulano@exemplo.com",
      veiculoTexto: "Fiat Argo 1.0 Prata 2021/2022",
      anuncioUrl:
        "https://www.usadosbr.com/carros-e-utilitarios/fiat/argo/1-0-504/2022-prata-sorocaba-sao-paulo-1844",
      anuncioIdExterno: "18812694",
      mensagemLead: "Olá, tenho interesse no veículo, favor entrar em contato. Obrigado!",
    });
  });

  it("junta a versão que o template quebra em duas linhas", () => {
    // "2021" numa linha e "/2022" na outra: sem juntar, o card perderia o ano
    // do modelo, que é o que desempata dois carros iguais no estoque.
    expect(parser!(email())!.veiculoTexto).toContain("2021/2022");
  });

  it("não guarda o link do painel do anunciante como anúncio", () => {
    const url = parser!(email())!.anuncioUrl;
    expect(url).not.toContain("console.usadosbr.com");
    expect(url).not.toContain("ajuda.usadosbr.com");
  });

  it("assunto que não é de lead é barrado antes de extrair", () => {
    expect(parser!(email({ assunto: "Usadosbr :: Seu anúncio foi aprovado" }))).toBeNull();
  });

  it("sem nome e sem telefone devolve null, para o e-mail seguir para a IA", () => {
    const vazio = email({ html: "<p>layout novo que ninguém previu</p>" });
    expect(parser!(vazio)).toBeNull();
  });
});
