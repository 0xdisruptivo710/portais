import type { ResultadoAtivacao } from "./ativacao.js";
import { decidirSupressao } from "./supressao.js";
import { montarTexto } from "./wts.js";

/**
 * ------------------------------------------------------------------------
 * Os números do ritmo. Eles são a diferença entre "o operador mandou o
 * primeiro contato para a fila do dia" e "a linha da loja foi bloqueada".
 * ------------------------------------------------------------------------
 *
 * PAUSA_ENTRE_ENVIOS_MS = 12s. Duas contas mandam nesse número:
 *
 * 1. O WTS aguenta cerca de 500 chamadas a cada 5 minutos, e cada lead custa
 *    até quatro (busca de contato, consulta de conversa, envio, conferência
 *    de status). A 12s por envio são 25 leads em 5 minutos, ou 100 chamadas:
 *    um quinto do limite. A folga não é preciosismo — o cron e os envios
 *    avulsos do painel disputam a mesma cota, ao mesmo tempo.
 * 2. O WhatsApp. Duzentas mensagens instantâneas saindo da mesma linha para
 *    gente que nunca falou com a loja é o padrão de bloqueio, não um pico de
 *    produtividade. 12s é cadência de pessoa mandando mensagem.
 *
 * TETO_POR_LOTE = 60. A 12s cada, o lote leva cerca de 12 minutos: é o que um
 * humano consegue acompanhar de uma sentada. E obriga uma decisão nova a cada
 * 60 mensagens, em vez de um clique autorizar 217 de uma vez.
 *
 * TETO_POR_REQUISICAO = 5 e PRAZO_REQUISICAO_MS = 200s. A function da Vercel
 * morre aos 300s, e o lote inteiro não cabe lá dentro. Por isso a requisição
 * processa uma FATIA e devolve o resto: quem emenda as fatias é o navegador,
 * e o estado que garante que ninguém recebe duas vezes é o do próprio lead.
 * Fatia pequena também é o que faz o botão "Parar" valer alguma coisa: a
 * interrupção acontece no fim da fatia em curso, cerca de um minuto, e não
 * depois de todo o lote.
 */
export const PAUSA_ENTRE_ENVIOS_MS = 12_000;
export const TETO_POR_LOTE = 60;
export const TETO_POR_REQUISICAO = 5;
export const PRAZO_REQUISICAO_MS = 200_000;

/**
 * Lista de ids inteiros e positivos, sem repetição, dentro do teto. Number("")
 * é 0 e Number(null) é 0, então a checagem de inteiro positivo é o que impede
 * um item ausente de virar consulta ao lead de id 0. Id repetido é recusado,
 * e não deduplicado em silêncio: a mesma pessoa duas vezes no mesmo lote é
 * sinal de que quem montou a lista se enganou.
 */
export function lerLeadIds(bruto: unknown, teto: number): number[] | null {
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > teto) return null;
  const ids: number[] = [];
  for (const item of bruto) {
    if (typeof item !== "number" || !Number.isInteger(item) || item <= 0) return null;
    if (ids.includes(item)) return null;
    ids.push(item);
  }
  return ids;
}

export type SituacaoLead = "enviado" | "bloqueado" | "falhou";

export interface ResultadoLead {
  lead_id: number;
  situacao: SituacaoLead;
  /** Por que não saiu (bloqueado) ou o que estourou (falhou). */
  motivo: string | null;
  /**
   * Só true com prova de entrega. O retorno do envio NUNCA basta: o WTS
   * responde QUEUED em mensagem que nunca chega a ninguém.
   */
  verificado: boolean;
  verificacao_detalhe: string | null;
}

export interface Fatia {
  resultados: ResultadoLead[];
  /** O que não foi processado nesta requisição, na ordem. */
  restantes: number[];
  parado: null | "fatia" | "prazo";
}

export interface DepsLote {
  /** O envio de um lead, com TODAS as guardas por lead (ver ativacao.ts). */
  ativar: (leadId: number) => Promise<ResultadoAtivacao>;
  /** enviado_em do lead, lido do banco na hora. null quando nunca recebeu. */
  jaEnviado: (leadId: number) => Promise<string | null>;
  dormir: (ms: number) => Promise<void>;
  agora: () => number;
}

/**
 * Uma fatia do lote: alguns leads, um a um, com pausa entre eles.
 *
 * Nada aqui pula guarda em nome de performance. Cada lead passa pela mesma
 * `ativarLeadDetalhado` do botão de um lead só — kill-switch, telefone,
 * remetente, texto, janela de recontato e a consulta de conversa aberta no
 * WTS. Um lead bloqueado é pulado e relatado; um lead que estoura é relatado
 * e o lote continua. O lote nunca força a guarda de conversa aberta: forçar é
 * decisão de quem está olhando para AQUELE lead, e no lote ninguém está.
 */
export async function executarFatia(leadIds: number[], deps: DepsLote): Promise<Fatia> {
  const inicio = deps.agora();
  const fila = [...leadIds];
  const resultados: ResultadoLead[] = [];
  let parado: Fatia["parado"] = null;

  while (fila.length > 0) {
    if (resultados.length >= TETO_POR_REQUISICAO) {
      parado = "fatia";
      break;
    }
    // Antes de COMEÇAR mais um lead, não no meio dele: a conta é o que já se
    // gastou, e o que falta para os 300s da function precisa caber um lead
    // inteiro mais a gravação dele.
    if (deps.agora() - inicio >= PRAZO_REQUISICAO_MS) {
      parado = "prazo";
      break;
    }

    const leadId = fila.shift() as number;

    // A retomada mora aqui. O lote pode morrer no meio (timeout, aba fechada,
    // rede) e ser retomado com a mesma lista: quem já recebeu tem enviado_em
    // gravado, e é isso — o estado do próprio lead, não um contador em
    // memória — que impede a segunda mensagem.
    let enviadoEm: string | null;
    try {
      enviadoEm = await deps.jaEnviado(leadId);
    } catch (e) {
      resultados.push(comoFalha(leadId, e));
      continue;
    }
    if (enviadoEm) {
      resultados.push({
        lead_id: leadId,
        situacao: "bloqueado",
        motivo: `ja enviado em ${enviadoEm}`,
        verificado: false,
        verificacao_detalhe: null,
      });
      continue;
    }

    try {
      const r = await deps.ativar(leadId);
      if (r.acao === "enviar") {
        resultados.push({
          lead_id: leadId,
          situacao: "enviado",
          motivo: null,
          verificado: r.verificado,
          verificacao_detalhe: r.verificacaoDetalhe,
        });
        // Pausa depois de cada mensagem que saiu, inclusive a última da
        // fatia: a última pausa é o intervalo antes do primeiro envio da
        // fatia seguinte. Sem ela, a cadência se perderia justamente na
        // emenda entre duas requisições.
        await deps.dormir(PAUSA_ENTRE_ENVIOS_MS);
      } else {
        // Bloqueado não gasta pausa: nenhuma mensagem saiu dali.
        resultados.push({
          lead_id: leadId,
          situacao: "bloqueado",
          motivo: r.motivo,
          verificado: false,
          verificacao_detalhe: null,
        });
      }
    } catch (e) {
      resultados.push(comoFalha(leadId, e));
      // Uma falha pode ter saído mesmo assim: o WTS recebeu e foi a resposta
      // que se perdeu. Pausar aqui é a escolha conservadora — o custo é
      // tempo, e o risco do contrário é dobrar a cadência sem perceber.
      await deps.dormir(PAUSA_ENTRE_ENVIOS_MS);
    }
  }

  return { resultados, restantes: fila, parado };
}

function comoFalha(leadId: number, e: unknown): ResultadoLead {
  return {
    lead_id: leadId,
    situacao: "falhou",
    motivo: e instanceof Error && e.message ? e.message : "falha ao enviar",
    verificado: false,
    verificacao_detalhe: null,
  };
}

export interface LeadDoLote {
  id: number;
  portal: string;
  nome: string | null;
  veiculo_texto: string | null;
  telefone_e164: string | null;
  enviado_em: string | null;
}

export interface ConfigDoLote {
  kill_switch: boolean;
  wts_from: string | null;
  texto_boas_vindas: string;
  janela_supressao_dias: number;
}

export interface ArgsResumo {
  /** Já cortados no teto do lote, na ordem em que serão enviados. */
  leads: LeadDoLote[];
  cfg: ConfigDoLote;
  /** Último enviado_em por telefone, em todo o cliente. */
  ultimoContatoPorTelefone: Map<string, string>;
  agora: Date;
}

export interface ResumoLote {
  /** Quantas mensagens devem sair. */
  vao_sair: number;
  /** Para quantas pessoas distintas. */
  pessoas: number;
  /** Quantas das que "vão sair" são da mesma pessoa que outra da lista. */
  repetidos: number;
  bloqueados: number;
  motivos: { motivo: string; quantidade: number }[];
}

/**
 * O que a confirmação mostra antes de o operador liberar o lote.
 *
 * "Tem certeza?" não serve para 60 mensagens. O que serve é o número: quantas
 * saem, para quantas pessoas distintas e quantas já estão bloqueadas, com o
 * motivo de cada bloqueio agrupado.
 *
 * Roda sobre o que já está no banco, sem tocar a rede. A guarda de conversa
 * aberta no WTS NÃO entra nesta conta de propósito: ela custa duas chamadas
 * por lead, e gastá-las na prévia consumiria a mesma cota que o envio precisa.
 * Ela continua valendo lead a lead na hora do envio, e a tela diz isso com
 * todas as letras em vez de deixar o operador achar que a prévia é a palavra
 * final.
 *
 * A ordem das guardas é a mesma do envio de um lead só (prepararEnvio, em
 * ativacao.ts), com "já enviado" na frente porque é o que executarFatia
 * confere primeiro.
 */
export function resumirLote(a: ArgsResumo): ResumoLote {
  const contagem = new Map<string, number>();
  const telefonesQueVaoSair: string[] = [];

  for (const lead of a.leads) {
    const motivo = motivoDoBloqueio(lead, a);
    if (motivo) {
      contagem.set(motivo, (contagem.get(motivo) ?? 0) + 1);
      continue;
    }
    // Sem motivo de bloqueio, o telefone existe: motivoDoBloqueio já barrou
    // quem não tem.
    telefonesQueVaoSair.push(lead.telefone_e164 as string);
  }

  const pessoas = new Set(telefonesQueVaoSair).size;

  return {
    vao_sair: telefonesQueVaoSair.length,
    pessoas,
    repetidos: telefonesQueVaoSair.length - pessoas,
    bloqueados: a.leads.length - telefonesQueVaoSair.length,
    motivos: [...contagem.entries()]
      .map(([motivo, quantidade]) => ({ motivo, quantidade }))
      .sort((x, y) => y.quantidade - x.quantidade || x.motivo.localeCompare(y.motivo)),
  };
}

function motivoDoBloqueio(lead: LeadDoLote, a: ArgsResumo): string | null {
  if (lead.enviado_em) return "ja enviado antes";
  if (!lead.telefone_e164) return "sem telefone normalizavel";
  if (!campoPreenchido(a.cfg.wts_from)) return "remetente nao configurado";

  // O texto é conferido DEPOIS da substituição, como no envio de um lead só:
  // um template só com placeholders que ninguém preencheu monta uma string
  // vazia, e isso só se sabe montando.
  const texto = montarTexto(a.cfg.texto_boas_vindas, {
    nome: primeiroNome(lead.nome),
    veiculo: lead.veiculo_texto,
    portal: ROTULOS[lead.portal] ?? null,
  });
  if (!texto) return "texto de boas-vindas vazio";

  const ultimo = a.ultimoContatoPorTelefone.get(lead.telefone_e164);
  const { suprimir, motivo } = decidirSupressao({
    ultimoContatoEm: ultimo ? new Date(ultimo) : null,
    janelaDias: a.cfg.janela_supressao_dias,
    agora: a.agora,
    killSwitch: a.cfg.kill_switch,
  });
  return suprimir ? (motivo ?? "suprimido") : null;
}

/**
 * Mesmos rótulos de ativacao.ts. Duplicado aqui pela mesma razão de sempre
 * nesta casa: o texto da prévia precisa ser idêntico ao que sai, e importar o
 * mapa de lá amarraria dois módulos que não se conhecem. src/lib/portais.test.ts
 * é quem impede a duplicação de divergir, e por isso o mapa é exportado: era
 * a única das três cópias que nenhum teste olhava, e três portais novos
 * entraram de uma vez.
 */
export const ROTULOS: Record<string, string> = {
  webmotors: "Webmotors",
  icarros: "iCarros",
  chavesnamao: "Chaves na Mão",
  comprecar: "Comprecar",
  olx: "OLX",
  mercadolivre: "Mercado Livre",
  carrosp: "Carro SP",
  usadosbr: "Usadosbr",
  olxchat: "OLX Chat",
};

function primeiroNome(nome: string | null): string | null {
  return nome?.trim().split(/\s+/)[0] ?? null;
}

function campoPreenchido(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}
