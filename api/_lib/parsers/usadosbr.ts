import type { LeadBruto } from "../../../src/tipos.js";
import { capturar, telefoneDoTrecho, textoDoEmail, umaLinha } from "./comum.js";
import { leadVazio, registrarParser, type Parser } from "./registro.js";

/**
 * Assunto de lead do Usadosbr. Mesmo padrão do portão de ehLead.ts, repetido
 * aqui como os outros parsers fazem, e frouxo pela mesma razão: UM e-mail de
 * lead observado, nenhum de ruído. O que se pode afirmar é o carimbo
 * "Usadosbr ::" no começo; a palavra que vem depois é a aposta, deliberada,
 * do lado de deixar passar em vez de barrar calado.
 */
const ASSUNTO_LEAD = /^\s*usadosbr\s*::.*\b(proposta|contato|interesse|mensagem)\b/i;

/**
 * O anúncio mora em `usadosbr.com` puro (ou `www.`). Os outros dois links do
 * corpo são de subdomínio e não servem para casar estoque: o painel do
 * anunciante (`console.usadosbr.com/central/propostas/...`), que aparece
 * ANTES do anúncio, e a central de ajuda (`ajuda.usadosbr.com`). Exigir o
 * host exato é o que separa os três.
 */
const LINK_ANUNCIO = /https?:\/\/(?:www\.)?usadosbr\.com\/[^\s"'<>)\]]+/i;

const parser: Parser = (email) => {
  if (!ASSUNTO_LEAD.test(email.assunto)) return null;

  // O `text/plain` deste portal vem vazio: tudo mora no HTML, como no Chaves
  // na Mão. `textoDoEmail` já é HTML primeiro.
  const texto = textoDoEmail(email);
  const lead: LeadBruto = leadVazio();

  lead.nome = umaLinha(capturar(texto, /\bNome:\s*([^\n]+)/));
  lead.email = capturar(texto, /\bE-mail:\s*([^\n]+)/);
  lead.telefone = telefoneDoTrecho(capturar(texto, /\bTel:\s*([^\n]+)/));

  const veiculo = umaLinha(capturar(texto, /\bVeículo:\s*([^\n]+)/));
  // A versão vai até o rótulo seguinte, e não até a quebra de linha: o
  // template parte "1.0 Prata 2021" e "/2022" em duas linhas, e é o "/2022"
  // que carrega o ano do MODELO. Ler só a primeira linha perderia metade do
  // que desempata dois carros iguais no estoque.
  const versao = umaLinha(capturar(texto, /\bVersão:\s*([\s\S]*?)\s*\bValor:/));
  // Juntar as duas linhas deixa um espaço antes da barra ("2021 /2022"), que
  // não existe em lugar nenhum do anúncio.
  const versaoLimpa = versao?.replace(/\s*\/\s*/g, "/") ?? null;
  lead.veiculoTexto = umaLinha([veiculo, versaoLimpa].filter(Boolean).join(" ") || null);

  const url = email.html.match(LINK_ANUNCIO)?.[0] ?? null;
  lead.anuncioUrl = url;
  // O portal numera o anúncio no corpo ("Cód: 18812694") e esse é o número
  // que ele próprio usa. O id que sobra no fim da URL é do slug, não do
  // anúncio.
  lead.anuncioIdExterno = capturar(texto, /\bCód:\s*([^\n]+)/);

  lead.mensagemLead = umaLinha(capturar(texto, /\bMensagem:\s*([\s\S]*?)\n{2,}/));

  if (!lead.nome && !lead.telefone) return null;
  return lead;
};

registrarParser("usadosbr", parser);
