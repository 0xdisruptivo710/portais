import { paraPipeWts } from "./telefone.js";

const BASE = "https://api.wts.chat";

/**
 * Erro de chamada à API do WTS, com o status HTTP anexado. Existe porque
 * `GET /core/v1/contact/phonenumber/{fone}` devolve 500 (não 404) quando o
 * contato não existe: quem consome precisa distinguir esse status específico
 * de um erro de verdade, e uma mensagem de texto não dá pra inspecionar com segurança.
 */
export class ErroWts extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroWts";
  }
}

export async function wtsRequest(
  metodo: string,
  caminho: string,
  corpo?: unknown,
  contentType = "application/*+json",
): Promise<unknown> {
  const token = process.env.WTS_TOKEN;
  if (!token) throw new Error("WTS_TOKEN ausente");

  const resp = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    // Sem "Bearer". Com Bearer, o WTS responde 401 em tudo.
    headers: { authorization: token, "content-type": contentType },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });

  const texto = await resp.text();
  if (!resp.ok) {
    throw new ErroWts(resp.status, `WTS ${metodo} ${caminho} ${resp.status}: ${texto.slice(0, 300)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

export function montarEnvio(a: { texto: string; from: string; e164: string }) {
  return { body: { text: a.texto }, from: a.from, to: paraPipeWts(a.e164) };
}

export function montarTexto(
  modelo: string,
  dados: { nome: string | null; veiculo: string | null; portal: string | null },
): string {
  return modelo
    .replace(/\{nome\}/g, dados.nome ?? "tudo bem")
    .replace(/\s*\{veiculo\}/g, dados.veiculo ? ` ${dados.veiculo}` : "")
    .replace(/\s*\{portal\}/g, dados.portal ? ` ${dados.portal}` : "")
    .replace(/\{[a-z]+\}/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,?!])/g, "$1")
    .trim();
}

/**
 * Busca o contato pelo telefone já normalizado (E.164 sem "+"). Contrato
 * confirmado em produção: contato inexistente responde 500 nesta rota, nunca
 * 404 — só esse status vira "não encontrado", qualquer outro estoura.
 */
export async function buscarContatoPorTelefone(e164: string): Promise<{ id: string } | null> {
  try {
    return (await wtsRequest("GET", `/core/v1/contact/phonenumber/${e164}`)) as { id: string } | null;
  } catch (erro) {
    if (erro instanceof ErroWts && erro.status === 500) return null;
    throw erro;
  }
}

export async function criarCard(args: {
  panelId: string;
  stepId: string;
  title: string;
  contactId: string;
}): Promise<{ id: string; contactIds: string[] }> {
  const corpo = {
    panelId: args.panelId,
    stepId: args.stepId,
    title: args.title,
    contactIds: [args.contactId],
  };

  const resposta = (await wtsRequest("POST", "/crm/v1/panel/card", corpo, "application/json")) as {
    id: string;
    contactIds?: string[];
  };

  // contactId singular é ignorado silenciosamente pela API: conferir o
  // retorno é a única forma de saber que o card nasceu com o contato de fato.
  if (!resposta.contactIds || resposta.contactIds.length === 0) {
    throw new Error(`card ${resposta.id} criado sem contato (contactIds vazio)`);
  }
  return { id: resposta.id, contactIds: resposta.contactIds };
}
