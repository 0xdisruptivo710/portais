import { getSupabase } from "./supabase.js";
import { processarEvento } from "./processar.js";
import { ativarLead } from "./ativacao.js";

export interface ResumoFila {
  processado: number;
  falha: number;
}

export interface OpcoesFila {
  /** Máximo de itens por execução. O default cabe nos 300s da function. */
  teto?: number;
}

/**
 * Teto de itens por execução. A function da Vercel tem 300s: parser, IA e
 * gravação de cada item não cabem, num lote maior, dentro desse tempo. O que
 * sobra fica na fila (status inalterado) e a próxima execução pega — por isso
 * o teto não perde nada. O script de backfill, que não tem esse limite, passa
 * um teto maior explicitamente.
 */
export const TETO_PADRAO = 200;

/**
 * Página de leitura da fila. Pequena de propósito: o processamento de cada
 * item é lento, e uma página grande só aumentaria a chance de a execução
 * morrer com a lista inteira já em memória. Também fica bem abaixo do corte
 * silencioso de 1000 linhas do PostgREST.
 */
const TAMANHO_PAGINA = 50;

/**
 * Interpreta os eventos crus que ainda ninguém interpretou
 * (`portais_eventos_raw.status = 'novo'`).
 *
 * Drena a FILA, não só o que a execução atual acabou de gravar: é isso que
 * faz backfill, reprocessamento manual e o que o cron ingeriu chegarem a
 * virar lead. Antes disso, um evento pré-existente com status 'novo' voltava
 * de `ingerir` como "duplicado" e nunca era interpretado por ninguém.
 */
export function interpretarPendentes(opcoes: OpcoesFila = {}): Promise<ResumoFila> {
  return drenar({
    tabela: "portais_eventos_raw",
    colunaStatus: "status",
    valorPendente: "novo",
    teto: opcoes.teto ?? TETO_PADRAO,
    executar: processarEvento,
  });
}

/**
 * Ativa os leads que ainda não foram ativados
 * (`portais_leads.status_ativacao = 'pendente'`).
 *
 * Em `dry_run` (modo do MVP) `ativarLead` grava a linha de auditoria em
 * portais_ativacoes e não envia nada — é justamente esse artefato que a
 * operação confere antes de liberar o envio real. Sem alguém drenando esta
 * fila, portais_ativacoes ficava vazia para sempre.
 */
export function ativarPendentes(opcoes: OpcoesFila = {}): Promise<ResumoFila> {
  return drenar({
    tabela: "portais_leads",
    colunaStatus: "status_ativacao",
    valorPendente: "pendente",
    teto: opcoes.teto ?? TETO_PADRAO,
    executar: ativarLead,
  });
}

interface Drenagem {
  tabela: string;
  colunaStatus: string;
  valorPendente: string;
  teto: number;
  executar: (id: number) => Promise<unknown>;
}

/**
 * Percorre a fila em páginas, tratando cada item isoladamente.
 *
 * Paginação por cursor (`id > último visto`) e não por offset: as linhas
 * mudam de status enquanto são processadas, e um offset sobre uma lista que
 * encolhe pula itens. O cursor também é a garantia de término — cada id é
 * tentado uma vez só por execução, mesmo quando marcar a falha não gruda.
 */
async function drenar(d: Drenagem): Promise<ResumoFila> {
  const sb = getSupabase();
  const resumo: ResumoFila = { processado: 0, falha: 0 };
  let cursor = 0;

  while (resumo.processado + resumo.falha < d.teto) {
    const restante = d.teto - resumo.processado - resumo.falha;
    const tamanho = Math.min(TAMANHO_PAGINA, restante);

    const { data, error } = await sb
      .from(d.tabela)
      .select("id")
      .eq(d.colunaStatus, d.valorPendente)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .range(0, tamanho - 1);
    if (error) throw new Error(error.message);

    const linhas = (data ?? []) as { id: number }[];
    if (linhas.length === 0) break;

    for (const linha of linhas) {
      cursor = linha.id;
      try {
        await d.executar(linha.id);
        resumo.processado++;
      } catch (e) {
        // Um item que estoura não pode derrubar o lote — e não pode sumir
        // calado: vira 'falhou' na tabela, que é o estado que já existe nos
        // tipos e que ninguém escrevia. Sem isso, o item quebrado voltaria
        // no topo da fila em toda execução, na frente dos leads novos.
        resumo.falha++;
        console.error(`${d.tabela} ${linha.id}: falhou`, e);
        await marcarFalha(sb, d, linha.id);
      }
    }
  }

  return resumo;
}

/**
 * Registrar a falha é best effort de propósito: se o próprio update falhar,
 * abortar o lote inteiro só transformaria um item problemático em varredura
 * perdida. O cursor da paginação garante que a execução termina mesmo assim.
 */
async function marcarFalha(sb: ReturnType<typeof getSupabase>, d: Drenagem, id: number): Promise<void> {
  try {
    const { data, error } = await sb
      .from(d.tabela)
      .update({ [d.colunaStatus]: "falhou" })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    // PostgREST devolve 200 com lista vazia quando a linha não existe (ou a
    // RLS barrou): conferir a linha de volta é a única forma de saber que
    // gravou. Mesma cicatriz de processar.ts e ativacao.ts.
    if (!data || data.length === 0) throw new Error(`${d.tabela} ${id} nao foi marcada como falhou`);
  } catch (e) {
    console.error(`${d.tabela} ${id}: falhou tambem ao registrar a falha`, e);
  }
}
