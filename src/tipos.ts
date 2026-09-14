export const PORTAIS = [
  "webmotors",
  "icarros",
  "chavesnamao",
  "comprecar",
  "olx",
  "mercadolivre",
  // CARRO SP (carsp.com.br), Usadosbr e o aviso de chat da OLX que chega pelo
  // domínio de marketing dela (newsolx.com.br). Os três estavam mandando
  // lead para a caixa da cliente sem ninguém capturar.
  "carrosp",
  "usadosbr",
  "olxchat",
] as const;

export type Portal = (typeof PORTAIS)[number];

/**
 * Portais que entregam os dados do lead no próprio e-mail.
 *
 * Quem fica de fora só manda aviso ("você tem mensagem nova"), sem nome nem
 * telefone, e vira card sem dados. É o caso da OLX, do Mercado Livre e do
 * olxchat, cujo aviso é ainda mais magro: nem o anúncio ele identifica.
 */
export const PORTAIS_COM_DADOS: Portal[] = [
  "webmotors",
  "icarros",
  "chavesnamao",
  "comprecar",
  "carrosp",
  "usadosbr",
];

/** E-mail já desmontado pelo mailparser, do jeito que o parser consome. */
export interface EmailCru {
  messageId: string;
  remetente: string;
  assunto: string;
  recebidoEm: string;
  texto: string;
  html: string;
  anexos: { nome: string; tipo: string; conteudoBase64: string }[];
}

/** O que um parser devolve. Ainda não normalizado. */
export interface LeadBruto {
  nome: string | null;
  telefone: string | null;
  email: string | null;
  veiculoTexto: string | null;
  anuncioUrl: string | null;
  anuncioIdExterno: string | null;
  mensagemLead: string | null;
}

export type StatusEvento = "novo" | "parseado" | "revisao" | "ignorado" | "falhou";
export type ModoEnvio = "dry_run" | "real";
