import type { LeadBruto } from "../../../src/tipos.js";
import { textoPlainEHtml, telefoneDoTrecho, umaLinha } from "./comum.js";
import { capturar } from "./comum.js";
import { leadVazio, registrarParser, type Parser } from "./registro.js";

/**
 * Assunto de lead do CARRO SP. Mesmo padrão do portão de ehLead.ts, repetido
 * aqui como os outros parsers fazem: o parser tem que ser seguro sozinho, sem
 * depender de quem o chamou ter conferido antes.
 *
 * Frouxo de propósito na segunda metade. A caixa da cliente guarda poucos
 * dias, e o que se viu foi UM e-mail de lead e nenhum de ruído: o carimbo
 * "CARRO SP" no começo é o que se pode afirmar, e o corpo desse mesmo e-mail
 * tem campo PROPOSTA e campo LEAD, sinal de que o template serve a mais de um
 * tipo de contato.
 */
const ASSUNTO_LEAD = /^\s*carro\s*sp\b.*\b(contato|proposta|interesse|mensagem)\b/i;

/**
 * Só o link do anúncio é `carrosp.com.br/comprar/`. O botão do WhatsApp vem
 * ANTES dele no HTML e carrega a mesma URL percent-encoded
 * (`https%3A%2F%2Fcarrosp.com.br%2Fcomprar%2F...`): guardar o wa.me no lugar
 * do anúncio não casaria com nenhum item do estoque. A barra literal exigida
 * aqui é o que separa os dois.
 */
const LINK_ANUNCIO = /https?:\/\/(?:www\.)?carrosp\.com\.br\/comprar\/[^\s"'<>)\]]+/i;

/**
 * Um campo da ficha, nos dois desenhos que o mesmo e-mail usa: o `text/plain`
 * alinha rótulo e valor com pontos ("ANO.............: 2016") e o HTML quebra
 * a linha entre os dois ("Ano:" em cima, "2016" embaixo).
 *
 * O primeiro ramo exige o valor na MESMA linha, e é aí que mora a cicatriz:
 * o e-mail real traz "PROPOSTA........: " em branco quando o contato nasceu
 * do botão de WhatsApp, e um `\s*` antes do grupo (que atravessa quebra de
 * linha) devolveria "LEAD............: WhatsApp" como se fosse a mensagem
 * escrita pelo lead. O segundo ramo só aceita o rótulo SEM pontos, que é a
 * forma do HTML, para não reabrir a mesma porta no plain.
 */
function campoDaFicha(texto: string, rotulo: string): string | null {
  const mesmaLinha = capturar(texto, new RegExp(`^\\s*${rotulo}\\.*:[^\\S\\n]+([^\\n]+)`, "mi"));
  if (mesmaLinha) return mesmaLinha;
  return capturar(texto, new RegExp(`^\\s*${rotulo}:[^\\S\\n]*\\n\\s*([^\\n]+)`, "mi"));
}

const parser: Parser = (email) => {
  if (!ASSUNTO_LEAD.test(email.assunto)) return null;

  // Plain primeiro (ao contrário dos outros parsers da casa): é ele que traz
  // a ficha com rótulo em todo campo. No HTML o carro é um <h3> sem rótulo
  // nenhum, e marca e modelo vêm grudados num título só.
  const texto = textoPlainEHtml(email);
  const lead: LeadBruto = leadVazio();

  // O lead do CARRO SP não tem nome nem e-mail: o portal manda o telefone de
  // quem clicou no botão de WhatsApp, e mais nada sobre a pessoa.
  lead.telefone = telefoneDoTrecho(campoDaFicha(texto, "FONE") ?? campoDaFicha(texto, "Telefone"));

  const marca = campoDaFicha(texto, "MARCA");
  const modelo = umaLinha(campoDaFicha(texto, "MODELO"));
  const ano = campoDaFicha(texto, "ANO");
  // Sem o text/plain sobra só o cartão do HTML, onde o carro é o título sem
  // rótulo logo acima do preço.
  const titulo = umaLinha(capturar(texto, /\n([^\n]+)\n+\s*Preço:/i));
  const base = [marca, modelo].filter(Boolean).join(" ") || titulo;
  lead.veiculoTexto = umaLinha([base, ano].filter(Boolean).join(" ") || null);

  // O href sobrevive ao `htmlParaTexto`, que descarta atributo: procurar no HTML cru.
  const url = `${email.html}\n${email.texto}`.match(LINK_ANUNCIO)?.[0] ?? null;
  lead.anuncioUrl = url;
  // O id é o ÚLTIMO trecho numérico do caminho, como na Webmotors: o ano do
  // modelo também é numérico e vem antes (`.../2016/7700286/`).
  lead.anuncioIdExterno = url?.split(/[?#]/)[0].match(/(\d+)\/?$/)?.[1] ?? null;

  lead.mensagemLead = umaLinha(campoDaFicha(texto, "PROPOSTA"));

  // Sem telefone não há primeiro contato possível (e nome este portal nunca
  // manda): devolver null empurra o e-mail para a IA, que é o caminho certo
  // para um layout que mudou.
  if (!lead.nome && !lead.telefone) return null;
  return lead;
};

registrarParser("carrosp", parser);
