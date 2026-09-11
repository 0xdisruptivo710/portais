import { describe, expect, it } from "vitest";
import { parserDoPortal } from "./index.js";
import type { EmailCru, Portal } from "../../../src/tipos.js";

/**
 * Fatura, comunicado e alerta chegam do mesmo domínio do lead: 26% dos 480
 * e-mails dos 90 dias varridos não são lead. O fixture do Comprecar já cobre
 * isso com e-mail real ("Veículo Reprovado", "Confirmação"), mas nos 10
 * e-mails guardados de Webmotors e Chaves na Mão não caiu nenhum ruído — daí
 * este teste, com assunto real e corpo montado à mão.
 *
 * O corpo de propósito traz telefone e nome no formato do portal: o que se
 * prova aqui é que o portão de assunto barra antes de extrair, não que faltou
 * dado para extrair.
 */
function emailDeRuido(assunto: string, corpo: string): EmailCru {
  return {
    messageId: "<ruido@exemplo.com>",
    remetente: "portal@exemplo.com",
    assunto,
    recebidoEm: "2026-09-01T12:00:00.000Z",
    texto: corpo,
    html: `<div>${corpo.replace(/\n/g, "<br>")}</div>`,
    anexos: [],
  };
}

const CASOS: [Portal, string, string][] = [
  [
    "webmotors",
    "Webmotors - Lembrete de Pagamento",
    "Sua fatura está próxima do vencimento.\nNome: Central de Cobrança\nTelefone: (11) 40040001\nE-mail: cobranca@exemplo.com",
  ],
  [
    "chavesnamao",
    "Comunicado importante para anunciantes",
    "Dados do contato:\nNome:Suporte\nTelefone: (41) 3333-4444\nEmail:\nsuporte@exemplo.com",
  ],
  [
    "comprecar",
    "Veículo Reprovado | Comprecar",
    "O veículo CHEVROLET - CELTA 1.0 MPFI LIFE 8V FLEX 2P MANUAL 2007/2008 foi reprovado\nNome do interessado: ninguém\nTelefone do interessado: (15) 99128-0217",
  ],
];

describe("portão de assunto", () => {
  for (const [portal, assunto, corpo] of CASOS) {
    it(`${portal}: "${assunto}" não vira lead`, () => {
      const parser = parserDoPortal(portal);
      expect(parser).not.toBeNull();
      expect(parser!(emailDeRuido(assunto, corpo))).toBeNull();
    });
  }
});
