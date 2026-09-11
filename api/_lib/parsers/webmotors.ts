import type { LeadBruto } from "../../../src/tipos.js";
import { capturar, telefoneDoTrecho, textoDoEmail, umaLinha } from "./comum.js";
import { leadVazio, registrarParser, type Parser } from "./registro.js";

/**
 * Do domínio da Webmotors chega lead e chega cobrança. Nos 90 dias varridos,
 * 11 dos 164 e-mails eram lembrete de pagamento, fatura ou comunicado. Sem
 * este portão, o rodapé de uma fatura (que tem telefone de suporte) viraria
 * "lead" com o telefone da Webmotors. O assunto é o sinal mais barato e mais
 * estável que separa os dois.
 */
const ASSUNTO_LEAD = /proposta para o carro|nova mensagem/i;

/** Só o link do anúncio é `webmotors.com.br/comprar/`; o resto é app, rede social e rastreio. */
const LINK_ANUNCIO = /https?:\/\/(?:www\.)?webmotors\.com\.br\/comprar\/[^\s"'<>)\]]+/i;

const parser: Parser = (email) => {
  if (!ASSUNTO_LEAD.test(email.assunto)) return null;

  const texto = textoDoEmail(email);
  const lead: LeadBruto = leadVazio();

  // Rótulo e valor ficam em linhas separadas no HTML e na mesma linha no
  // text/plain: o `\s*` antes do grupo cobre os dois desenhos.
  lead.nome = umaLinha(capturar(texto, /\bNome:\s*([^\n]+)/));
  lead.email = capturar(texto, /\bE-mail:\s*([^\n]+)/);
  lead.telefone = telefoneDoTrecho(capturar(texto, /\bTelefone:\s*([^\n]+)/));

  const veiculo = umaLinha(capturar(texto, /\bVeículo:\s*([^\n]+)/));
  const ano = capturar(texto, /\bAno:\s*([^\n]+)/);
  // O ano vem em campo próprio, e é ele que desempata o casamento com o
  // estoque quando a revenda tem o mesmo modelo em dois anos.
  lead.veiculoTexto = veiculo && ano ? `${veiculo} ${ano}` : veiculo;

  // O href sobrevive ao `htmlParaTexto`, que descarta atributo: procurar no HTML cru.
  const url = `${email.html}\n${email.texto}`.match(LINK_ANUNCIO)?.[0] ?? null;
  lead.anuncioUrl = url;
  // O id é o ÚLTIMO trecho numérico do caminho. O ano do modelo também é um
  // trecho numérico e vem antes (`.../4-portas/2023/76947935`).
  lead.anuncioIdExterno = url?.split(/[?#]/)[0].match(/(\d+)\/?$/)?.[1] ?? null;

  // A Webmotors envolve a frase do lead em aspas curvas de enfeite.
  const mensagem = umaLinha(capturar(texto, /recebeu:\s*([\s\S]*?)\n{2,}/));
  lead.mensagemLead = mensagem ? umaLinha(mensagem.replace(/^[”“"]+|[”“"]+$/g, "")) : null;

  // Sem nome nem telefone não há primeiro contato possível: devolver null manda
  // o e-mail para a IA, que é o caminho certo para um layout que mudou.
  if (!lead.nome && !lead.telefone) return null;
  return lead;
};

registrarParser("webmotors", parser);
