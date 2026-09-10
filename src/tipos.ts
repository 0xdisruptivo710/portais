export const PORTAIS = [
  "webmotors",
  "icarros",
  "chavesnamao",
  "comprecar",
  "olx",
  "mercadolivre",
] as const;

export type Portal = (typeof PORTAIS)[number];

/** Portais que entregam os dados do lead no próprio e-mail. */
export const PORTAIS_COM_DADOS: Portal[] = [
  "webmotors",
  "icarros",
  "chavesnamao",
  "comprecar",
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
