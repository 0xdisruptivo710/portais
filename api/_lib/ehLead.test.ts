import { describe, expect, it } from "vitest";
import { ehLead } from "./ehLead.js";
import type { Portal } from "../../src/tipos.js";

/**
 * Assunto de lead e assunto de ruído real, um par por portal, extraídos dos
 * 480 e-mails reais varridos em 90 dias (ver relatório da tarefa). O ruído é
 * sempre do mesmo remetente do lead — fatura, propaganda, alerta de
 * segurança, comunicado — por isso o portão é o assunto, não o domínio.
 */
const CASOS: { portal: Portal; lead: string; ruido: string }[] = [
  { portal: "webmotors", lead: "Proposta para o carro Honda Civic 2020", ruido: "Webmotors - Lembrete de Pagamento" },
  { portal: "olx", lead: "Oba! Tem mensagem nova de Fulano", ruido: "Parabéns, o seu anúncio está ativo!" },
  { portal: "chavesnamao", lead: "[LEAD] Ford Ka 2019", ruido: "Comunicado importante para anunciantes" },
  { portal: "mercadolivre", lead: "Você tem uma pessoa interessada no seu anúncio", ruido: "Seu código de verificação chegou" },
  { portal: "comprecar", lead: "Contato de Interesse - Chevrolet Celta", ruido: "Veículo Reprovado | Comprecar" },
];

describe("ehLead", () => {
  for (const { portal, lead, ruido } of CASOS) {
    it(`${portal}: assunto de lead passa`, () => {
      expect(ehLead(portal, lead)).toBe(true);
    });

    it(`${portal}: assunto de ruído real é barrado`, () => {
      expect(ehLead(portal, ruido)).toBe(false);
    });
  }

  // Também barrados: os exemplos de ruído do relatório que não são específicos
  // de um único portal (chegam do domínio de qualquer um deles).
  it.each([
    "Sua fatura está próxima do vencimento",
    "Documento fiscal e link de pagamento",
    "Escolhemos a foto do seu anúncio por você",
    "Alerta de segurança: houve um acesso à sua conta",
    "Horário de atendimento nos dias 07 e 08/09",
  ])("webmotors: ruído genérico '%s' é barrado", (assunto) => {
    expect(ehLead("webmotors", assunto)).toBe(false);
  });

  it("portal sem padrão catalogado (icarros) é fail-open: deixa passar", () => {
    expect(ehLead("icarros", "qualquer coisa, nunca varremos icarros ainda")).toBe(true);
  });
});
