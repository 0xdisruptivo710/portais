import { describe, expect, it } from "vitest";
import { parserDoPortal } from "./index.js";
import type { EmailCru } from "../../../src/tipos.js";

/**
 * O e-mail do CARRO SP, com a estrutura do e-mail real e os dados trocados.
 *
 * O `.eml` de verdade fica em fixtures/carrosp/ (gitignored: é telefone de
 * pessoa real numa caixa de cliente, e o repositório é público). O que este
 * arquivo guarda é a ESTRUTURA, que é o que o parser lê: o text/plain traz a
 * ficha alinhada com pontos e o HTML traz o mesmo carro dentro de um <h3> sem
 * rótulo, com o telefone em outro formato.
 *
 * Duas particularidades do template que o parser precisa aguentar, as duas
 * presentes no e-mail real:
 * 1. `PROPOSTA........: ` vem VAZIO quando o contato nasceu do botão de
 *    WhatsApp. Um regex que atravessa a quebra de linha devolveria
 *    "LEAD............: WhatsApp" como se fosse a mensagem do lead.
 * 2. O lead não tem nome. Quem sustenta o card é o telefone, e por isso a
 *    guarda final do parser não pode exigir nome.
 */
const TEXTO_PLAIN = [
  "MENSAGEM ENVIADA PELO FORMULÁRIO DE PROPOSTA DO SITE",
  "",
  "*** Dados do Veículo ***",
  "",
  "PLACA...........: ABC-1D23",
  "MARCA...........: JEEP",
  "MODELO..........: Renegade 1.8 16V 4P FLEX LONGITUDE AUTOMÁTICO",
  "ANO.............: 2016",
  "COR.............: Prata",
  "PREÇO...........: R$ 65.900,00",
  "",
  "*** Dados do Remetente ***",
  "",
  "FONE............: (11) 900000000",
  "PROPOSTA........: ",
  "",
  "LEAD............: WhatsApp",
  "",
  "ANUNCIO.........: https://carrosp.com.br/comprar/suv/jeep/renegade/1.8-16v-4p-flex-longitude-automatico/2016/7700286/",
  "",
  "LINK MINHA CONTA: https://carrosp.com.br/minha-conta/propostaview/?proposta=3114331",
  "",
  "Dicas de Segurança:",
  "",
  "-Nunca faça pagamentos adiantados em hipótese alguma.",
].join("\n");

const HTML = `
<div class="body">
  <h1> Novo contato de Whatsapp </h1>
  <p align="center"> Olá, Malentachi Veículos! </p>
  <div class="info">
    <p>Dados do usuário:</p>
    <p>Telefone: <strong>(11) 90000-0000</strong></p>
  </div>
  <div class="cta-buttons">
    <a href="https://wa.me/5511900000000?text=Ol%C3%A1%2C%20recebi%20sua%20mensagem%20referente%20a%20este%20an%C3%BAncio%20https%3A%2F%2Fcarrosp.com.br%2Fcomprar%2Fsuv%2Fjeep%2Frenegade%2F1.8-16v-4p-flex-longitude-automatico%2F2016%2F7700286%2F">Falar pelo Whatsapp</a>
    <a href="https://carrosp.com.br/comprar/suv/jeep/renegade/1.8-16v-4p-flex-longitude-automatico/2016/7700286/">Ver Anúncio no Site</a>
  </div>
  <div class="info"><h3 style="text-align: center;">JEEP Renegade 1.8 16V 4P FLEX LONGITUDE AUTOMÁTICO</h3></div>
  <div class="info"><p>Preço:<br><strong>R$ 65.900,00</strong></p></div>
  <div class="info"><p>Placa:<br><strong>ABC-1D23</strong></p></div>
  <div class="info"><p>Ano:<br><strong>2016</strong></p></div>
  <div class="info"><p>Cor:<br><strong>Prata</strong></p></div>
</div>`;

function email(over: Partial<EmailCru> = {}): EmailCru {
  return {
    messageId: "<carrosp@exemplo.com>",
    remetente: "CARRO SP <noreply@carsp.com.br>",
    assunto: "CARRO SP - Contato do whatsapp enviado pelo site",
    recebidoEm: "2026-09-12T15:31:03.000Z",
    texto: TEXTO_PLAIN,
    html: HTML,
    anexos: [],
    ...over,
  };
}

const parser = parserDoPortal("carrosp");

describe("parser do CARRO SP", () => {
  it("está registrado", () => {
    expect(parser).not.toBeNull();
  });

  it("lê a ficha do text/plain, que é a parte estruturada do e-mail", () => {
    expect(parser!(email())).toEqual({
      nome: null,
      telefone: "(11) 900000000",
      email: null,
      veiculoTexto: "JEEP Renegade 1.8 16V 4P FLEX LONGITUDE AUTOMÁTICO 2016",
      anuncioUrl:
        "https://carrosp.com.br/comprar/suv/jeep/renegade/1.8-16v-4p-flex-longitude-automatico/2016/7700286/",
      anuncioIdExterno: "7700286",
      mensagemLead: null,
    });
  });

  it("campo PROPOSTA vazio não engole a linha de baixo", () => {
    // Sem isso o lead nasceria com a mensagem "LEAD............: WhatsApp".
    expect(parser!(email())!.mensagemLead).toBeNull();
  });

  it("lê a proposta escrita quando ela existe", () => {
    const comProposta = TEXTO_PLAIN.replace(
      "PROPOSTA........: ",
      "PROPOSTA........: Tenho interesse, aceita troca?",
    );
    expect(parser!(email({ texto: comProposta }))!.mensagemLead).toBe("Tenho interesse, aceita troca?");
  });

  it("sem o text/plain, ainda tira telefone e carro do HTML", () => {
    const so = parser!(email({ texto: "" }));
    expect(so).not.toBeNull();
    expect(so!.telefone).toBe("(11) 90000-0000");
    expect(so!.veiculoTexto).toBe("JEEP Renegade 1.8 16V 4P FLEX LONGITUDE AUTOMÁTICO 2016");
    expect(so!.anuncioUrl).toContain("/comprar/suv/jeep/renegade/");
  });

  it("não confunde o link do WhatsApp com o link do anúncio", () => {
    // O href do wa.me carrega a URL do anúncio percent-encoded e aparece
    // ANTES dela no HTML. Guardar o wa.me não casaria com nenhum estoque.
    expect(parser!(email())!.anuncioUrl).not.toContain("wa.me");
  });

  it("assunto que não é de lead é barrado antes de extrair", () => {
    const fatura = email({ assunto: "CARRO SP - Sua fatura está disponível" });
    expect(parser!(fatura)).toBeNull();
  });

  it("sem telefone nenhum devolve null, para o e-mail seguir para a IA", () => {
    const semFone = email({ texto: TEXTO_PLAIN.replace("FONE............: (11) 900000000", ""), html: "" });
    expect(parser!(semFone)).toBeNull();
  });
});
