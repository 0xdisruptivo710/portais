import { buscarContatoPorTelefone, wtsRequest } from "./wts.js";

/**
 * Janela de recência, em dias, usada quando `portais_config` não traz
 * `janela_conversa_dias`.
 *
 * Sete dias é o meio-termo entre os dois erros: uma negociação de carro
 * respira em dias ("te mando os detalhes amanhã", silêncio na quarta, volta
 * na sexta), então uma janela de 24h deixaria passar exatamente o caso que
 * queimou a loja; e uma janela de meses bloquearia o lead que voltou por
 * outro portal muito depois de a conversa antiga ter morrido.
 */
export const JANELA_CONVERSA_PADRAO_DIAS = 7;

/** Só os campos que esta decisão lê. O item do WTS traz muito mais. */
export interface SessaoWts {
  contactId?: string | null;
  lastMessageIn?: string | null;
  lastMessageOut?: string | null;
  lastInteractionDate?: string | null;
  status?: string | null;
  windowStatus?: string | null;
}

export interface ResultadoConversa {
  suprimir: boolean;
  /** Motivo legível na tela do operador. null quando nada bloqueou. */
  motivo: string | null;
  /**
   * `true` quer dizer "não foi possível SABER se existe conversa", que é
   * diferente de "não existe conversa". Os dois suprimem, mas só o segundo
   * pode ser contornado pelo operador: dá para decidir por cima de uma
   * informação, nunca por cima de uma ignorância.
   */
  falhou: boolean;
}

const LIBERADO: ResultadoConversa = { suprimir: false, motivo: null, falhou: false };

/**
 * PageSize máximo da API do WTS. Com o filtro `ContactId` aplicado no
 * servidor, uma página é a conta inteira de sessões daquele contato — não
 * existe paginação aqui, e nem faria sentido: a pergunta é sobre a mensagem
 * MAIS RECENTE, não sobre o histórico completo.
 */
const PAGINA = 100;

/**
 * A data da última mensagem da sessão, seja de quem for.
 *
 * Os três campos são lidos e comparados, nunca escolhidos por ordem de
 * preferência: `lastMessageIn` sozinho perderia a conversa em que só a loja
 * falou por último, que é justamente a que termina em "Ok, combinado".
 */
export function ultimaMensagemDaSessao(s: SessaoWts): Date | null {
  let maior: Date | null = null;
  for (const bruto of [s.lastMessageIn, s.lastMessageOut, s.lastInteractionDate]) {
    if (typeof bruto !== "string" || bruto.trim() === "") continue;
    const data = new Date(bruto);
    if (Number.isNaN(data.getTime())) continue;
    if (!maior || data.getTime() > maior.getTime()) maior = data;
  }
  return maior;
}

export interface ArgsConversa {
  sessoes: SessaoWts[];
  contatoId: string;
  janelaDias: number;
  agora: Date;
}

/**
 * O critério é RECÊNCIA DE MENSAGEM, e de propósito não é `status` nem
 * `windowStatus`.
 *
 * `status` mede higiene de atendimento, não negociação viva: o atendente que
 * fecha a sessão logo depois de "Ok, combinado" deixa CLOSED em cima de uma
 * conversa que está no auge (o caso real), e o que esquece de fechar deixa
 * OPEN para sempre em cima de uma conversa morta há meses. `windowStatus`
 * também não serve nesta conta: o canal não oficial deixa tudo em ACTIVE, sem
 * a janela de 24h que daria significado ao campo (ver scripts/diagnostico-wts.ts).
 *
 * Mensagem trocada recentemente é fato observável. É esse o critério.
 */
export function decidirConversaAberta(a: ArgsConversa): ResultadoConversa {
  // Rede de segurança contra o comportamento conhecido da API (.NET): todo
  // parâmetro que ela não reconhece é ignorado EM SILÊNCIO, e a listagem
  // volta com a conta inteira em vez de dar erro. Se `ContactId` mudar de
  // nome um dia, sem esta conferência a consulta passaria a devolver as
  // sessões de todo mundo e o app suprimiria a base inteira sem avisar.
  const doContato = a.sessoes.filter((s) => s.contactId === a.contatoId);

  if (doContato.length === 0 && a.sessoes.length > 0 && a.sessoes.every((s) => !s.contactId)) {
    // Veio sessão, mas sem dono identificável: não dá para dizer que é deste
    // contato nem que não é. Contrato mudado não pode virar "não há conversa".
    return {
      suprimir: true,
      falhou: true,
      motivo: "nao foi possivel conferir conversa no WTS: sessao sem contactId na resposta",
    };
  }

  let maisRecente: Date | null = null;
  for (const sessao of doContato) {
    const quando = ultimaMensagemDaSessao(sessao);
    if (quando && (!maisRecente || quando.getTime() > maisRecente.getTime())) maisRecente = quando;
  }
  if (!maisRecente) return LIBERADO;

  const ms = a.agora.getTime() - maisRecente.getTime();
  // `<=` e não `<`: a borda exata fica do lado que não manda mensagem. Data no
  // futuro (relógio fora de hora dos dois lados) cai aqui também, como deve.
  if (ms <= a.janelaDias * 86_400_000) {
    return {
      suprimir: true,
      falhou: false,
      motivo: `ja existe conversa no WTS, ultima mensagem ${rotuloDesde(ms)}`,
    };
  }
  return LIBERADO;
}

/**
 * A guarda que faltava: antes de mandar o primeiro contato, pergunta ao WTS
 * se aquele telefone já está conversando com a loja.
 *
 * Fail-closed em toda falha. Os dois erros não custam o mesmo: não contatar
 * agora um lead legítimo é recuperável e fica registrado com o motivo; mandar
 * "vi que gostou de um lindo veículo" no meio de uma negociação que a equipe
 * já estava fechando não é, e já aconteceu com cliente real.
 */
export async function conferirConversaNoWts(a: {
  e164: string;
  janelaDias: number;
  agora: Date;
}): Promise<ResultadoConversa> {
  let contatoId: string;
  try {
    const contato = await buscarContatoPorTelefone(a.e164);
    // Contato inexistente é resposta, não falha: quem nunca falou com a loja
    // não tem conversa aberta. buscarContatoPorTelefone já traduz o 500 dessa
    // rota (o contrato do WTS para "não existe") em null.
    if (!contato) return LIBERADO;
    if (typeof contato.id !== "string" || contato.id.trim() === "") {
      return falha("busca de contato sem id utilizavel");
    }
    contatoId = contato.id;
  } catch (e) {
    return falha(textoDoErro(e));
  }

  let sessoes: SessaoWts[];
  try {
    const resposta = (await wtsRequest(
      "GET",
      // PascalCase obrigatório: `contactId` minúsculo é ignorado em silêncio
      // e a resposta volta com a conta inteira.
      `/chat/v2/session?ContactId=${encodeURIComponent(contatoId)}&PageSize=${PAGINA}`,
    )) as { items?: SessaoWts[] } | null;
    sessoes = resposta?.items ?? [];
  } catch (e) {
    return falha(textoDoErro(e));
  }

  return decidirConversaAberta({ sessoes, contatoId, janelaDias: a.janelaDias, agora: a.agora });
}

function falha(detalhe: string): ResultadoConversa {
  return { suprimir: true, falhou: true, motivo: `nao foi possivel conferir conversa no WTS: ${detalhe}` };
}

function textoDoErro(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

/**
 * Duração em português curto, para caber na frase que o operador lê. Sem
 * travessão e sem asterisco, como todo texto que vai para a tela.
 */
function rotuloDesde(ms: number): string {
  const minutos = Math.floor(ms / 60_000);
  if (minutos < 1) return "agora ha pouco";
  if (minutos < 60) return `ha ${minutos}min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `ha ${horas}h`;
  return `ha ${Math.floor(horas / 24)}d`;
}
