import type { LeadBruto } from "../../../src/tipos.js";
import { capturar, telefoneDoTrecho, textoDoEmail, umaLinha } from "./comum.js";
import { leadVazio, registrarParser, type Parser } from "./registro.js";

/**
 * Assunto de lead é sempre `Contato de Interesse`. Do mesmo remetente também
 * chegam `Veículo Reprovado | Comprecar` e `Confirmação - Comprecar` (3 dos 8
 * e-mails guardados como fixture são justamente esses). O aviso de reprovação
 * cita marca, modelo e ano do carro: sem o portão, viraria um lead sem dono.
 */
const ASSUNTO_LEAD = /^\s*contato de interesse/i;

/**
 * O link do anúncio aparece como texto no corpo ("Link do veículo:"), não no
 * `href` — todo `href` do Comprecar é um redirecionador de rastreio
 * (`r.sendmail.comprecar.com.br/tr/cl/...`) que não serve para casar estoque.
 */
const LINK_ANUNCIO = /https?:\/\/(?:www\.)?comprecar\.com\.br\/[^\s"'<>)\]]+/i;

const parser: Parser = (email) => {
  if (!ASSUNTO_LEAD.test(email.assunto)) return null;

  const texto = textoDoEmail(email);
  const lead: LeadBruto = leadVazio();

  lead.nome = umaLinha(capturar(texto, /Nome do interessado:\s*([^\n]+)/));
  lead.email = capturar(texto, /Email do interessado:\s*([^\n]+)/);
  // A linha do telefone pode terminar com "(Prefere ser contatado via
  // WhatsApp)", que não pode entrar no número.
  lead.telefone = telefoneDoTrecho(capturar(texto, /Telefone do interessado:\s*([^\n]+)/));

  const veiculo = umaLinha(capturar(texto, /\bVeículo:\s*([^\n]+)/));
  const ano = capturar(texto, /\bAno:\s*([^\n]+)/);
  lead.veiculoTexto = veiculo && ano ? `${veiculo} ${ano}` : veiculo;

  const url = texto.match(LINK_ANUNCIO)?.[0] ?? null;
  lead.anuncioUrl = url;
  // Aqui o id vem grudado no fim do slug por hífen, não separado por barra:
  // `.../up-10-mpi-move-up-12v-flex-4p-manual-2471576`.
  lead.anuncioIdExterno = url?.split(/[?#]/)[0].match(/-(\d+)\/?$/)?.[1] ?? null;

  // A mensagem vai de "Mensagem:" até o bloco do veículo. No text/plain os
  // dois ficam na MESMA linha ("...obrigado Veículo: T4 3.2"), por isso o
  // limite é o rótulo em si e não uma quebra de linha.
  lead.mensagemLead = umaLinha(capturar(texto, /Mensagem:\s*([\s\S]*?)\s*Veículo:/));

  if (!lead.nome && !lead.telefone) return null;
  return lead;
};

registrarParser("comprecar", parser);
