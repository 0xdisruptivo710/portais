import type { ModoEnvio } from "../../src/tipos.js";
import { getSupabase } from "./supabase.js";
import { decidirSupressao } from "./supressao.js";
import { montarEnvio, montarTexto, wtsRequest } from "./wts.js";

export type Acao = "dry_run" | "suprimido" | "adiar" | "enviar";

export interface Janela {
  horarioInicio: string;
  horarioFim: string;
}

export interface OpcoesAtivacao {
  /**
   * Autorização humana explícita para ESTE lead, vinda do botão do painel.
   *
   * Vale só nesta chamada: não toca em portais_config, e o `modo_envio` do
   * cliente continua exatamente como estava depois do envio. Todas as demais
   * guardas continuam valendo, em especial a supressão, que não pode ser
   * contornada por botão.
   *
   * Também é o que liga a conferência de entrega pós-envio: é o caminho em
   * que existe um humano esperando a resposta na tela.
   */
  autorizadoManualmente?: boolean;
}

export interface ResultadoAtivacao {
  acao: Acao;
  /** Motivo da supressão, em texto legível. null quando nada bloqueou. */
  motivo: string | null;
  /** O que o WTS devolveu no POST de envio. null quando nada foi enviado. */
  respostaWts: unknown;
  /**
   * Só é true quando a conferência posterior provou a entrega. O retorno do
   * POST de envio NUNCA basta para isso.
   */
  verificado: boolean;
  verificacaoDetalhe: string | null;
}

/** O que a tela mostra ao operador ANTES de ele confirmar o envio. */
export interface PreviaEnvio {
  /** O texto exato que sairá, já com nome, veículo e portal substituídos. */
  texto: string;
  telefoneExibicao: string | null;
  /** Destino no formato que vai no payload do WTS (+55|DDDNUMERO). */
  para: string | null;
  bloqueado: boolean;
  motivo: string | null;
  ultimoContatoEm: string | null;
  diasDesdeUltimoContato: number | null;
}

/**
 * A hora é lida sempre em São Paulo, nunca no fuso do servidor. A Vercel roda
 * em UTC: sem isso, "20h" viraria 17h local e a janela deixaria passar envio
 * de madrugada.
 *
 * `horario_inicio`/`horario_fim` são `time` no Postgres: o PostgREST devolve
 * "08:00:00", não "08:00". Truncar os dois lados para HH:MM antes de
 * comparar é obrigatório — sem isso a comparação lexicográfica inverte as
 * duas bordas ("08:00" >= "08:00:00" é false; "20:00" < "20:00:00" é true).
 */
export function dentroDaJanela(agora: Date, j: Janela): boolean {
  const hhmm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(agora);
  const inicio = j.horarioInicio.slice(0, 5);
  const fim = j.horarioFim.slice(0, 5);
  return hhmm >= inicio && hhmm < fim;
}

/**
 * Fail-closed em duas frentes: qualquer modo que não seja exatamente "real"
 * cai em dry_run, e fora da janela o envio é adiado em vez de sair. Um typo na
 * config nunca pode virar disparo para cliente real.
 *
 * Em dry_run a janela é ignorada de propósito: registrar o que seria enviado
 * às 3h da manhã é inofensivo e útil para conferência.
 */
export function decidirAcao(
  a: {
    modo: ModoEnvio;
    suprimir: boolean;
    motivo: string | null;
    agora?: Date;
    autorizadoManualmente?: boolean;
  } & Janela,
): Acao {
  if (a.suprimir) return "suprimido";

  // A autorização manual vem DEPOIS da supressão e ANTES de tudo mais. Ela
  // vale mais que o modo da config (é o botão que autoriza aquele envio, não
  // a config) e dispensa a janela de horário: quem clica está olhando para o
  // lead, e isso é uma guarda mais forte que o relógio. "adiar" também não
  // teria sentido aqui — nada repescaria a autorização manual depois (a fila
  // só devolve lead 'pendente' ao cron, que em dry_run marcaria o lead como
  // simulado e perderia a intenção do operador em silêncio). O preço dessa
  // decisão é o registro: um envio manual fora do horário combinado é
  // gravado em portais_ativacoes com o modo dizendo exatamente isso.
  if (a.autorizadoManualmente) return "enviar";

  if (a.modo !== "real") return "dry_run";
  return dentroDaJanela(a.agora ?? new Date(), a) ? "enviar" : "adiar";
}

interface LeadBanco {
  id: number;
  cliente_slug: string;
  telefone_e164: string | null;
  telefone_exibicao: string | null;
  nome: string | null;
  veiculo_texto: string | null;
  portal: string;
}

interface ConfigBanco {
  texto_boas_vindas: string;
  wts_from: string | null;
  janela_supressao_dias: number;
  horario_inicio: string;
  horario_fim: string;
  modo_envio: ModoEnvio;
  kill_switch: boolean;
}

interface Preparo {
  lead: LeadBanco;
  cfg: ConfigBanco;
  texto: string;
  suprimir: boolean;
  motivo: string | null;
  payload: ReturnType<typeof montarEnvio> | null;
  ultimoContatoEm: Date | null;
}

/**
 * Tudo o que antecede a decisão de enviar: lê lead e config, monta o texto e
 * roda a cadeia de guardas. Nenhuma linha daqui toca a rede nem grava nada,
 * e é por isso que a prévia da tela (previaDeEnvio) e o envio de verdade
 * (ativarLeadDetalhado) podem compartilhar exatamente este código — o
 * operador confirma o mesmo texto que vai sair, não uma aproximação montada
 * do lado do navegador.
 */
async function prepararEnvio(sb: ReturnType<typeof getSupabase>, leadId: number): Promise<Preparo> {
  const { data: lead, error } = await sb
    .from("portais_leads")
    .select("*")
    .eq("id", leadId)
    .single();
  if (error || !lead) throw new Error(error?.message ?? "lead nao encontrado");

  const { data: cfg } = await sb
    .from("portais_config")
    .select("*")
    .eq("cliente_slug", lead.cliente_slug)
    .single();
  if (!cfg) throw new Error("config do cliente ausente");

  // Texto é montado ANTES da cadeia de guardas abaixo porque é o RESULTADO
  // (não o template cru) que entra na checagem: um template só com
  // placeholders que a IA não preencheu (ex.: "{veiculo}" sem carro) monta
  // uma string vazia, e isso só se sabe depois da substituição.
  const texto = montarTexto(cfg.texto_boas_vindas, {
    nome: primeiroNome(lead.nome),
    veiculo: lead.veiculo_texto,
    portal: rotuloPortal(lead.portal),
  });

  // Três guardas na mesma cadeia, com a mesma disciplina: qualquer campo que
  // vá direto pro payload do WTS (from, texto, to) sem conteúdo aproveitável
  // vira supressão com motivo explícito, ANTES de tocar a rede. Corrigir só
  // o telefone e deixar from/texto abertos foi exatamente o bug que fez esta
  // função precisar ficar assim.
  let suprimir: boolean;
  let motivo: string | null;
  let ultimoContatoEm: Date | null = null;
  if (!lead.telefone_e164) {
    // Normalizador (telefone.ts) devolve null de propósito quando o número é
    // ambíguo, em vez de adivinhar. Essa checagem tem que vir ANTES da busca
    // de supressão abaixo — `.eq("telefone_e164", null)` não casa com nada em
    // SQL, então rodar essa consulta pra um lead sem telefone só mascararia
    // o motivo real com um "sem supressão" incorreto.
    suprimir = true;
    motivo = "sem telefone normalizavel";
  } else if (!campoPreenchido(cfg.wts_from)) {
    // Falta de remetente é config do cliente, não do lead: bloqueia todo
    // envio até ser corrigida. Checar aqui (antes da consulta de
    // reincidência) evita bater no banco à toa em todo lead do cliente
    // enquanto a config estiver incompleta.
    suprimir = true;
    motivo = "remetente nao configurado";
  } else if (!texto) {
    suprimir = true;
    motivo = "texto de boas-vindas vazio";
  } else {
    // Último contato com ESTE telefone, em qualquer portal. É o que impede o
    // lead que anuncia em três portais de receber três "oi" no mesmo dia.
    const { data: anteriores } = await sb
      .from("portais_leads")
      .select("enviado_em")
      .eq("cliente_slug", lead.cliente_slug)
      .eq("telefone_e164", lead.telefone_e164)
      .not("enviado_em", "is", null)
      .order("enviado_em", { ascending: false })
      .limit(1);

    ultimoContatoEm = anteriores?.[0]?.enviado_em ? new Date(anteriores[0].enviado_em) : null;

    ({ suprimir, motivo } = decidirSupressao({
      ultimoContatoEm,
      janelaDias: cfg.janela_supressao_dias,
      agora: new Date(),
      killSwitch: cfg.kill_switch,
    }));
  }

  const payload = lead.telefone_e164
    ? montarEnvio({ texto, from: cfg.wts_from ?? "", e164: lead.telefone_e164 })
    : null;

  return { lead, cfg, texto, suprimir, motivo, payload, ultimoContatoEm };
}

/**
 * O que a tela mostra antes de o operador confirmar. Sai da MESMA preparação
 * do envio: se a prévia diz que o texto é X, é X que sai.
 *
 * `ultimoContatoEm` vem preenchido mesmo quando a janela de supressão já
 * passou e o envio está liberado — o operador precisa saber que aquela
 * pessoa já foi abordada antes de abordar de novo, e isso não é a mesma
 * pergunta que "o sistema vai bloquear".
 */
export async function previaDeEnvio(leadId: number): Promise<PreviaEnvio> {
  const p = await prepararEnvio(getSupabase(), leadId);
  return {
    texto: p.texto,
    telefoneExibicao: p.lead.telefone_exibicao ?? null,
    para: p.payload?.to ?? null,
    bloqueado: p.suprimir,
    motivo: p.motivo,
    ultimoContatoEm: p.ultimoContatoEm?.toISOString() ?? null,
    diasDesdeUltimoContato: p.ultimoContatoEm
      ? Math.floor((Date.now() - p.ultimoContatoEm.getTime()) / 86_400_000)
      : null,
  };
}

/**
 * Assinatura preservada para quem só precisa da decisão: a fila (fila.ts)
 * chama assim, lead a lead, e os 300s da function não comportam mais que
 * isso. Quem precisa contar a verdade ao operador na tela usa
 * ativarLeadDetalhado.
 */
export async function ativarLead(leadId: number, opcoes: OpcoesAtivacao = {}): Promise<Acao> {
  return (await ativarLeadDetalhado(leadId, opcoes)).acao;
}

export async function ativarLeadDetalhado(
  leadId: number,
  opcoes: OpcoesAtivacao = {},
): Promise<ResultadoAtivacao> {
  const sb = getSupabase();
  const manual = opcoes.autorizadoManualmente === true;

  const { lead, cfg, suprimir, motivo, payload } = await prepararEnvio(sb, leadId);

  const janela = { horarioInicio: cfg.horario_inicio, horarioFim: cfg.horario_fim };
  const agora = new Date();

  const acao = decidirAcao({
    modo: cfg.modo_envio,
    suprimir,
    motivo,
    autorizadoManualmente: manual,
    agora,
    ...janela,
  });

  // `modo` na auditoria descreve COMO a ativação foi decidida, e não o que
  // estava na config: uma linha com modo 'dry_run' e resposta_wts preenchida
  // seria uma contradição para quem for ler isso depois. Envio autorizado no
  // botão é gravado como manual, e o valor carrega, no próprio nome, a
  // informação de que a janela de horário foi dispensada.
  const modoRegistrado = !manual
    ? cfg.modo_envio
    : dentroDaJanela(agora, janela)
      ? "manual"
      : "manual_fora_janela";

  // A linha de auditoria é gravada SEMPRE, inclusive quando nada sai. É ela
  // que responde depois "por que esse lead não recebeu mensagem".
  const { data: ativacao } = await sb
    .from("portais_ativacoes")
    .insert({
      lead_id: leadId,
      modo: modoRegistrado,
      payload_enviado: payload,
      erro: acao === "suprimido" ? motivo : acao === "adiar" ? "fora da janela" : null,
    })
    .select("id");

  if (!ativacao || ativacao.length === 0) {
    throw new Error("insert em portais_ativacoes nao devolveu linha");
  }

  const semEnvio = (decidida: Acao): ResultadoAtivacao => ({
    acao: decidida,
    motivo:
      decidida === "suprimido" ? motivo : decidida === "adiar" ? "fora da janela de horario" : null,
    respostaWts: null,
    verificado: false,
    verificacaoDetalhe: null,
  });

  if (acao === "adiar") {
    // Fora da janela: o lead PERMANECE "pendente" — não gravamos nada aqui —
    // para que a próxima execução do cron dentro do horário repesque este
    // mesmo id via ativarPendentes (fila.ts só seleciona status_ativacao =
    // 'pendente'). A linha de auditoria acima já registra a tentativa adiada
    // com o motivo "fora da janela".
    return semEnvio(acao);
  }

  if (acao !== "enviar") {
    await atualizarLead(sb, leadId, {
      status_ativacao: acao === "suprimido" ? "suprimido" : "dry_run",
      motivo_supressao: acao === "suprimido" ? motivo : null,
    });
    return semEnvio(acao);
  }

  // Daqui para baixo só roda com modo_envio = 'real' ou com autorização
  // manual explícita para este lead.
  const resposta = await wtsRequest("POST", "/chat/v1/message/send", payload);

  // TODO: entre o envio acima e a gravação abaixo ainda existe uma janela em
  // que uma queda derruba a função com a mensagem já entregue e nada
  // registrado — mais estreita que antes (era duas gravações, agora é uma),
  // mas não eliminada. A correção real é a supressão passar a considerar a
  // linha de portais_ativacoes (gravada ANTES do envio, já com
  // payload_enviado) em vez de depender só de portais_leads.enviado_em, só
  // que isso é mudança de desenho — decidir se uma tentativa conta como
  // contato — e cabe ao operador, não a este fix.

  // Ordem importa: o estado do lead é o que sustenta a supressão por
  // reincidência (a consulta acima filtra por `enviado_em is not null`), e
  // resposta_wts é auditoria auxiliar. Gravar o lead ANTES garante que, se a
  // gravação de auditoria abaixo estourar, a mensagem já entregue não vire um
  // envio invisível que a próxima rodada repete para o mesmo cliente.
  await atualizarLinha(sb, "portais_leads", leadId, {
    status_ativacao: "enviado",
    enviado_em: agora.toISOString(),
  });

  const verificacao = manual
    ? await conferirEntrega(resposta)
    : // O caminho do cron fica com uma chamada de rede por lead. Conferir
      // status em lote é outra decisão (um GET a mais por lead dentro dos
      // 300s da function) e cabe ao operador tomar. O que não pode é o
      // registro mentir dizendo que conferiu.
      { verificado: false, detalhe: "envio automatico: conferencia de entrega nao executada" };

  // Falha aqui não pode abortar a função: o estado crítico acima já foi
  // gravado, e lançar depois dele só escureceria um envio que já deu certo
  // (a próxima leitura veria o lead sem "enviado" e repetiria a mensagem).
  // console.warn preserva o rastro pra auditoria manual, sem propagar.
  try {
    await atualizarLinha(sb, "portais_ativacoes", ativacao[0].id, {
      resposta_wts: resposta,
      verificado: verificacao.verificado,
      verificacao_detalhe: verificacao.detalhe,
    });
  } catch (e) {
    console.warn(`ativacao ${ativacao[0].id}: falha ao gravar resposta_wts`, e);
  }

  return {
    acao: "enviar",
    motivo: null,
    respostaWts: resposta,
    verificado: verificacao.verificado,
    verificacaoDetalhe: verificacao.detalhe,
  };
}

/**
 * Só estes dois provam que a mensagem chegou ao destinatário. QUEUED e SENT
 * dizem apenas que ela entrou ou saiu do gateway do WTS — é exatamente esse
 * o retorno que já apareceu em mensagem que nunca chegou a ninguém. Tratar
 * QUEUED como entrega é a cicatriz que esta função existe para não repetir.
 */
const STATUS_ENTREGUE = new Set(["DELIVERED", "READ"]);

/**
 * Uma tentativa, nunca mais que uma, e fail-open: se não der para conferir,
 * o resultado é "não verificado" com o motivo por escrito. Nada aqui pode
 * derrubar um envio que já saiu, e nada aqui pode afirmar entrega sem prova.
 *
 * Vale lembrar de quem lê o registro depois: esta consulta acontece segundos
 * após o envio, então o normal é ela pegar a mensagem ainda em QUEUED ou
 * SENT. "verificado = false" aqui quer dizer "não foi possível provar agora",
 * e não "não chegou".
 */
async function conferirEntrega(resposta: unknown): Promise<{ verificado: boolean; detalhe: string }> {
  const id = idDaMensagem(resposta);
  if (!id) {
    return {
      verificado: false,
      detalhe: "resposta do envio nao trouxe id da mensagem: entrega nao verificada",
    };
  }

  try {
    const status = await wtsRequest("GET", `/chat/v1/message/${encodeURIComponent(id)}/status`);
    const valor = campoTexto(status, "status");
    if (!valor) {
      return {
        verificado: false,
        detalhe: `consulta de status sem campo status (id ${id}): entrega nao verificada`,
      };
    }
    if (STATUS_ENTREGUE.has(valor.toUpperCase())) {
      return { verificado: true, detalhe: `status ${valor} confirmado na consulta (id ${id})` };
    }
    return {
      verificado: false,
      detalhe: `status ${valor} (id ${id}): saiu do gateway, entrega ao destinatario nao comprovada`,
    };
  } catch (e) {
    return {
      verificado: false,
      detalhe: `falha ao consultar o status (id ${id}): ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * O contrato do corpo de resposta do envio não está documentado do lado do
 * WTS, então a leitura é defensiva: sem id não há o que consultar, e isso é
 * registrado como "não verificado" em vez de virar exceção.
 */
function idDaMensagem(resposta: unknown): string | null {
  return campoTexto(resposta, "id") ?? campoTexto(resposta, "messageId");
}

function campoTexto(valor: unknown, campo: string): string | null {
  if (typeof valor !== "object" || valor === null) return null;
  const conteudo = (valor as Record<string, unknown>)[campo];
  return typeof conteudo === "string" && conteudo.trim().length > 0 ? conteudo : null;
}

/**
 * PostgREST devolve HTTP 200 com lista vazia quando o "id" não existe — a
 * mesma cicatriz do insert em portais_ativacoes (e de marcar()/gravarLead()
 * em processar.ts). Conferir a linha de volta é a única forma de saber que o
 * update gravou de verdade, não só que a chamada não deu erro. Genérico por
 * tabela porque a mesma checagem se repete em portais_leads e portais_ativacoes.
 */
async function atualizarLinha(
  sb: ReturnType<typeof getSupabase>,
  tabela: string,
  id: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await sb.from(tabela).update(payload).eq("id", id).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(`update em ${tabela} nao devolveu linha (id ${id})`);
  }
}

function atualizarLead(
  sb: ReturnType<typeof getSupabase>,
  leadId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  return atualizarLinha(sb, "portais_leads", leadId, payload);
}

function primeiroNome(nome: string | null): string | null {
  return nome?.trim().split(/\s+/)[0] ?? null;
}

/**
 * Um campo de configuração só conta como preenchido se for string com algo
 * além de espaço. "" e "   " são o mesmo problema que null/undefined — o
 * campo nunca foi configurado de verdade — mas `?? ""` e checagens de
 * truthiness comuns não pegam os dois primeiros.
 */
function campoPreenchido(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

// Exportado só para o teste de consistência (src/lib/portais.test.ts) — que
// compara este mapa com o duplicado em src/lib/portais.ts. Nenhum código de
// produção deste lado importa o mapa de fora; quem quiser o rótulo usa
// rotuloPortal().
export const ROTULOS: Record<string, string> = {
  webmotors: "Webmotors",
  icarros: "iCarros",
  chavesnamao: "Chaves na Mão",
  comprecar: "Comprecar",
  olx: "OLX",
  mercadolivre: "Mercado Livre",
};

function rotuloPortal(p: string): string | null {
  return ROTULOS[p] ?? null;
}
