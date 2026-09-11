import type { LeadBruto } from "../../../src/tipos.js";
import { capturar, telefoneDoTrecho, textoDoEmail, umaLinha } from "./comum.js";
import { leadVazio, registrarParser, type Parser } from "./registro.js";

/**
 * O Chaves na Mão carimba o assunto do lead com `[LEAD]` e manda comunicado
 * operacional sem carimbo nenhum (7 dos 61 e-mails em 90 dias). O portão é o
 * próprio carimbo do portal, não uma heurística nossa.
 */
const ASSUNTO_LEAD = /^\s*\[LEAD\]/i;

/**
 * Todo link sai embrulhado no rastreio do Postmark, com a URL real
 * percent-encoded no meio do caminho:
 * `https://track.pstmrk.it/3s/www.chavesnamao.com.br%2Fcarro%2F...%2Fid-8906206%2F/uYc-/...`
 * O trecho embrulhado termina na primeira barra literal, porque as barras da
 * URL real viraram `%2F`. Guardar o link de rastreio no lugar do anúncio não
 * serviria para nada: ele muda a cada e-mail e não casa com o estoque.
 */
const LINK_EMBRULHADO = /(www\.chavesnamao\.com\.br%2Fcarro%2F[^/"'\s<>]+)/i;
/** Layout futuro sem rastreio: o link cru. */
const LINK_CRU = /https?:\/\/(?:www\.)?chavesnamao\.com\.br\/carro\/[^\s"'<>)\]]+/i;

function linkDoAnuncio(html: string): string | null {
  const embrulhado = html.match(LINK_EMBRULHADO)?.[1];
  if (embrulhado) return `https://${decodeURIComponent(embrulhado)}`;
  return html.match(LINK_CRU)?.[0] ?? null;
}

const parser: Parser = (email) => {
  if (!ASSUNTO_LEAD.test(email.assunto)) return null;

  const texto = textoDoEmail(email);
  const lead: LeadBruto = leadVazio();

  // O portal manda só o primeiro nome, colado no rótulo: `Nome:Fulano`.
  lead.nome = umaLinha(capturar(texto, /\bNome:\s*([^\n]+)/));
  lead.email = capturar(texto, /\bEmail:\s*([^\n]+)/);
  lead.telefone = telefoneDoTrecho(capturar(texto, /\bTelefone:\s*([^\n]+)/));

  // O título do veículo não tem rótulo: é a linha logo abaixo da referência.
  const bloco = texto.match(/Referência:\s*(\S+)\s*\n+\s*([^\n]+)/);
  lead.veiculoTexto = umaLinha(bloco?.[2] ?? null);
  // `Referência` é o número que o próprio portal usa para o anúncio, e ele se
  // repete no assunto — sobrevive a uma mudança no corpo do e-mail.
  lead.anuncioIdExterno = bloco?.[1] ?? capturar(email.assunto, /Ref\.\s*(\S+)/);

  lead.anuncioUrl = linkDoAnuncio(email.html);

  // Sem campo de mensagem: o lead não escreve nada, o e-mail só informa se o
  // contato nasceu de simulação de financiamento ou de conversa no WhatsApp.
  lead.mensagemLead = null;

  if (!lead.nome && !lead.telefone) return null;
  return lead;
};

registrarParser("chavesnamao", parser);
