import type { Portal } from "../../src/tipos.js";

/**
 * Padrão de assunto que separa lead de ruído do mesmo remetente (fatura,
 * propaganda, alerta de segurança, comunicado, código de verificação).
 * Extraído dos 480 e-mails reais varridos em 90 dias: dentro destes 5
 * portais, todo lead de verdade bate em um destes padrões, e nenhum e-mail
 * de ruído bate.
 */
const PADRAO_LEAD: Partial<Record<Portal, RegExp>> = {
  webmotors: /^\s*proposta para o carro|nova mensagem/i,
  olx: /^\s*oba!\s*tem mensagem nova/i,
  chavesnamao: /^\s*\[lead\]/i,
  mercadolivre: /pessoa interessada/i,
  comprecar: /^\s*contato de interesse/i,
};

/**
 * Gate de assunto no topo do pipeline: chamado antes de qualquer parser ou
 * IA, para todo portal. Decisão de fail-open x fail-closed, pesando os dois
 * erros possíveis:
 *
 * - Portal SEM padrão catalogado aqui (ex.: icarros, sem volume nos 90 dias
 *   varridos): fail-open, devolve `true`. Sem e-mail real pra calibrar um
 *   padrão, bloquear às cegas arriscaria descartar lead de verdade em
 *   silêncio — o pecado capital deste sistema. Fail-open aqui não é "assumir
 *   risco novo": é deixar o comportamento do portal idêntico ao de antes
 *   deste gate existir (parser ou IA decidem, como sempre decidiram).
 * - Portal COM padrão catalogado, assunto que não bate: fail-closed, devolve
 *   `false`. O padrão foi extraído de e-mails reais que cobrem lead e ruído
 *   dos dois lados — não bater É a evidência que temos de ruído, e é o
 *   próprio propósito da função: sem fail-closed aqui, o gate não bloqueia
 *   nada e os leads falsos continuam voltando. O custo aceito: um formato de
 *   assunto genuinamente novo (o portal mudou o template do e-mail de lead)
 *   também não bate e vira "ignorado" em vez de cair na fila de revisão —
 *   por isso este mapa pede nova varredura sempre que isso acontecer.
 */
export function ehLead(portal: Portal, assunto: string): boolean {
  const padrao = PADRAO_LEAD[portal];
  if (!padrao) return true;
  return padrao.test(assunto);
}
