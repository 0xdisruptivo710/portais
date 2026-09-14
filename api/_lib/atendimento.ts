import { conversaEmAndamento, type ConsultaConversa } from "./conversa.js";

/**
 * ------------------------------------------------------------------------
 * "Esse lead já está sendo atendido?" — a pergunta que o vendedor fazia
 * abrindo o WhatsApp lead a lead.
 * ------------------------------------------------------------------------
 *
 * A medição que motivou este arquivo: dos 40 leads mais recentes com
 * telefone, 30 já eram contato no WTS com conversa nos últimos 7 dias. E,
 * entre 25 leads recentes, 14 dessas conversas COMEÇARAM depois do e-mail do
 * portal, várias em 12 a 18 minutos. O cliente vê o anúncio, o portal dispara
 * o e-mail, e o próprio cliente chama a loja no WhatsApp minutos depois.
 *
 * Esse detalhe manda em todo o desenho:
 *
 * 1. Conferir na CAPTURA não serviria. No instante em que o e-mail chega a
 *    conversa ainda não existe: o dado nasceria "sem conversa" para a maioria
 *    exatamente dos leads que viram conversa logo depois.
 * 2. Conferir cada linha ao abrir a lista também não: são duas chamadas por
 *    lead (contato + sessões) e o WTS aguenta cerca de 500 a cada 5 minutos,
 *    cota que o envio disputa ao mesmo tempo.
 *
 * O que sobra, e é o que está aqui: conferir EM LOTE, só os leads que a tela
 * está mostrando, com cache curto e teto de chamadas. Quem passou do teto
 * volta com o que o cache tinha, e a próxima abertura da lista confere.
 *
 * A segunda decisão de fundo é não gravar booleano. O que fica no banco é a
 * DATA da última mensagem, e "em atendimento" é recalculado a cada leitura.
 * Assim o registro envelhece para o lado seguro: com o tempo ele só pode
 * PARAR de dizer "em atendimento", nunca começar. O sentido perigoso (a
 * conversa que nasceu depois da conferência) é justamente o que o TTL cobre.
 */

/**
 * Dez minutos. É o intervalo entre "o vendedor abriu a lista" e "o vendedor
 * abriu a lista de novo depois de trabalhar alguns leads": curto o bastante
 * para pegar a conversa que nasceu 12 minutos depois do e-mail (o caso
 * medido), longo o bastante para que recarregar a página três vezes seguidas
 * não gaste três vezes a cota do WTS.
 */
export const TTL_CONFERENCIA_MS = 10 * 60 * 1000;

/**
 * Vinte e cinco leads por chamada, ou 50 requisições ao WTS: um décimo da
 * cota de 5 minutos. A folga não é preciosismo — o envio em lote (12s por
 * mensagem, até 4 chamadas cada) e os envios avulsos do painel disputam a
 * mesma cota, ao mesmo tempo.
 */
export const TETO_CONSULTAS = 25;

/**
 * O que a tela mostra na coluna Atendimento.
 *
 * Quatro estados, e não um booleano, porque três coisas diferentes se
 * escondiam atrás de "não está em atendimento": ninguém conferiu ainda, não
 * há como conferir (lead sem telefone, como OLX e Mercado Livre) e conferimos
 * e não há conversa. Só o último é fila limpa de verdade, e é o único que
 * pode entrar num filtro que promete isso.
 */
export type EstadoAtendimento = "em_atendimento" | "sem_conversa" | "nao_conferido" | "sem_telefone";

/**
 * As colunas do lead que esta decisão lê. As duas de conversa são opcionais
 * de propósito: enquanto a migration não rodar elas voltam `undefined` do
 * `select("*")`, e a tela tem que continuar de pé dizendo "não conferido" em
 * vez de quebrar.
 */
export interface LeadParaAtendimento {
  id: number;
  telefone_e164: string | null;
  conversa_ultima_mensagem_em?: string | null;
  conversa_conferida_em?: string | null;
}

export interface ItemAtendimento {
  lead_id: number;
  estado: EstadoAtendimento;
  ultima_mensagem_em: string | null;
  conferido_em: string | null;
  /** Por que não deu para conferir agora. null quando não houve falha. */
  detalhe: string | null;
}

export interface DepsAtendimento {
  /** Os leads pedidos, lidos do banco. Ordem irrelevante: quem ordena é a lista pedida. */
  lerLeads: (leadIds: number[]) => Promise<LeadParaAtendimento[]>;
  consultar: (e164: string) => Promise<ConsultaConversa>;
  gravar: (leadId: number, campos: Record<string, string | null>) => Promise<void>;
  agora: () => Date;
  janelaDias: number;
  /** Só os testes passam: em produção vale TETO_CONSULTAS. */
  teto?: number;
}

/**
 * O estado de atendimento de um lead, recalculado a partir da data gravada.
 *
 * Nunca lê booleano do banco, e é essa a diferença que importa: um booleano
 * gravado em maio continuaria dizendo "em atendimento" hoje.
 */
export function estadoDeAtendimento(
  lead: LeadParaAtendimento,
  a: { janelaDias: number; agora: Date },
): EstadoAtendimento {
  if (!lead.telefone_e164) return "sem_telefone";
  if (!dataValida(lead.conversa_conferida_em)) return "nao_conferido";
  const ultima = dataValida(lead.conversa_ultima_mensagem_em);
  return conversaEmAndamento(ultima, a.janelaDias, a.agora) ? "em_atendimento" : "sem_conversa";
}

/**
 * Vale a pena gastar chamada de rede com este lead agora?
 *
 * Sem telefone não há o que perguntar. Com conferência recente, o cache vale:
 * o custo de uma resposta com até dez minutos é uma linha desatualizada na
 * tela, e o custo de ignorar o cache é a cota do WTS que o envio precisa.
 */
export function precisaConferir(lead: LeadParaAtendimento, agora: Date): boolean {
  if (!lead.telefone_e164) return false;
  const conferido = dataValida(lead.conversa_conferida_em);
  if (!conferido) return true;
  return agora.getTime() - conferido.getTime() > TTL_CONFERENCIA_MS;
}

/**
 * Confere no WTS os leads pedidos, na ORDEM em que vieram, até o teto.
 *
 * A ordem importa: a tela manda os ids como estão na lista (mais recentes
 * primeiro), e é onde o vendedor está olhando que a informação precisa estar
 * certa. O que passou do teto volta com o que o cache tinha.
 *
 * Um lead que estoura não derruba o lote, e uma consulta que FALHOU não grava
 * nada. Gravar `conversa_conferida_em` depois de uma falha registraria "este
 * lead não tem conversa" com base em nada, e o filtro da tela passaria a
 * oferecer como fila limpa justamente quem ninguém conseguiu conferir.
 */
export async function atualizarAtendimento(
  leadIds: number[],
  deps: DepsAtendimento,
): Promise<{ itens: ItemAtendimento[]; consultados: number }> {
  const agora = deps.agora();
  const teto = deps.teto ?? TETO_CONSULTAS;

  const leads = await deps.lerLeads(leadIds);
  const porId = new Map(leads.map((l) => [l.id, l]));

  const itens: ItemAtendimento[] = [];
  let consultados = 0;

  for (const id of leadIds) {
    const lead = porId.get(id);
    // Id pedido que não existe no banco simplesmente não volta: a tela pediu
    // por uma lista que pode ter mudado, e inventar linha seria pior.
    if (!lead) continue;

    let detalhe: string | null = null;

    if (precisaConferir(lead, agora) && consultados < teto) {
      consultados++;
      try {
        const consulta = await deps.consultar(lead.telefone_e164 as string);
        if (consulta.falhou) {
          detalhe = consulta.detalhe;
        } else {
          lead.conversa_ultima_mensagem_em = consulta.ultimaMensagemEm?.toISOString() ?? null;
          lead.conversa_conferida_em = agora.toISOString();
          await deps.gravar(lead.id, {
            conversa_ultima_mensagem_em: lead.conversa_ultima_mensagem_em,
            conversa_conferida_em: lead.conversa_conferida_em,
          });
        }
      } catch (e) {
        detalhe = e instanceof Error && e.message ? e.message : "falha ao conferir conversa no WTS";
      }
    }

    itens.push({
      lead_id: lead.id,
      estado: detalhe ? estadoQuandoNaoDeu(lead, agora, deps.janelaDias) : estadoDeAtendimento(lead, { janelaDias: deps.janelaDias, agora }),
      ultima_mensagem_em: lead.conversa_ultima_mensagem_em ?? null,
      conferido_em: lead.conversa_conferida_em ?? null,
      detalhe,
    });
  }

  return { itens, consultados };
}

/**
 * Consulta que falhou tendo cache velho: o cache ainda vale para dizer "em
 * atendimento" (a conversa existia e a data não mudou por causa da falha),
 * mas não pode virar "sem conversa" — isso seria afirmar, por cima de uma
 * falha, exatamente o que ninguém conseguiu conferir.
 */
function estadoQuandoNaoDeu(lead: LeadParaAtendimento, agora: Date, janelaDias: number): EstadoAtendimento {
  const estado = estadoDeAtendimento(lead, { janelaDias, agora });
  return estado === "em_atendimento" ? estado : "nao_conferido";
}

/** Texto do banco vira Date, ou null. Data inválida nunca pode virar Invalid Date. */
function dataValida(bruto: string | null | undefined): Date | null {
  if (typeof bruto !== "string" || bruto.trim() === "") return null;
  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}
