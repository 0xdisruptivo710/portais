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
  // O aviso de chat da OLX vem do domínio de marketing dela (dicas@newsolx.com.br),
  // que no mesmo e-mail já empurra vitrine de categoria, "baixe o app" e
  // "anuncie grátis". Aqui o padrão é apertado de propósito: o que passa é a
  // frase do aviso, e só ela.
  {
    portal: "olxchat",
    lead: "Tem mensagem te esperando no chat!",
    ruido: "Faça uma grana extra com o que está parado na sua casa",
  },
];

/**
 * CARRO SP e Usadosbr entraram no catálogo com UM e-mail de lead cada e
 * NENHUM e-mail de ruído observado (a caixa da cliente guarda só os últimos
 * dias). O padrão de cada um por isso é deliberadamente frouxo na segunda
 * metade: prende o carimbo do portal no começo do assunto, que é estável, e
 * aceita qualquer das palavras com que portal avisa contato novo. Prefere-se
 * deixar passar um comunicado (que vira card estranho e visível) a barrar em
 * silêncio um segundo tipo de lead que a amostra não mostrou.
 */
const CASOS_AMOSTRA_PEQUENA: { portal: Portal; leads: string[]; ruidos: string[] }[] = [
  {
    portal: "carrosp",
    leads: [
      // O único e-mail real observado.
      "CARRO SP - Contato do whatsapp enviado pelo site",
      // O corpo desse mesmo e-mail tem campo "PROPOSTA" e campo "LEAD", ou
      // seja, o portal manda mais de um tipo de contato pelo mesmo template.
      "CARRO SP - Proposta enviada pelo site",
      "CARRO SP - Novo interesse no seu anúncio",
    ],
    ruidos: [
      "CARRO SP - Sua fatura está disponível",
      "CARRO SP - Renove seu plano de anúncios",
      "Boleto CARRO SP vence amanhã",
    ],
  },
  {
    portal: "usadosbr",
    leads: [
      // O único e-mail real observado.
      "Usadosbr :: Proposta Recebida",
      "Usadosbr :: Contato Recebido",
      "Usadosbr :: Nova mensagem",
    ],
    ruidos: [
      "Usadosbr :: Seu anúncio foi aprovado",
      "Usadosbr :: Fatura disponível",
      "Novidades do Usadosbr para a sua loja",
    ],
  },
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

  for (const { portal, leads, ruidos } of CASOS_AMOSTRA_PEQUENA) {
    for (const assunto of leads) {
      it(`${portal}: "${assunto}" passa`, () => {
        expect(ehLead(portal, assunto)).toBe(true);
      });
    }
    for (const assunto of ruidos) {
      it(`${portal}: "${assunto}" é barrado`, () => {
        expect(ehLead(portal, assunto)).toBe(false);
      });
    }
  }

  it("portal sem padrão catalogado (icarros) é fail-open: deixa passar", () => {
    expect(ehLead("icarros", "qualquer coisa, nunca varremos icarros ainda")).toBe(true);
  });
});
