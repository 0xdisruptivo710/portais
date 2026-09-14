import {
  atualizarAtendimento,
  type DepsAtendimento,
  type LeadParaAtendimento,
} from "./_lib/atendimento.js";
import { consultarConversaNoWts, janelaConversaDias } from "./_lib/conversa.js";
import { erro, json } from "./_lib/http.js";
import { lerLeadIds } from "./_lib/lote.js";
import { exigirOrigemConfiavel } from "./_lib/origem.js";
import { exigirAdmin } from "./_lib/sessao.js";
import { getSupabase } from "./_lib/supabase.js";

// Único cliente ativo por enquanto (mesmo hardcode de config.ts e leads.ts).
const CLIENTE_SLUG = "malentachi";

/**
 * Teto de leads por chamada. É o tamanho de uma página da lista (LIMITE_PADRAO
 * em leads.ts): a tela pergunta pelo que está mostrando, nunca pela base.
 * Quantos desses realmente viram chamada ao WTS é outra conta, menor, e mora
 * em atendimento.ts.
 */
const TETO_POR_CHAMADA = 50;

/**
 * POST /api/conversas: "quais desses leads já estão em atendimento?"
 *
 * A pergunta que o vendedor fazia abrindo o WhatsApp lead a lead. A medição
 * que motivou o endpoint: dos 40 leads mais recentes com telefone, 30 já
 * tinham conversa no WTS nos últimos 7 dias.
 *
 * É POST, e não GET, por duas razões: a lista de ids é do tamanho da página e
 * não cabe bem numa query string, e a chamada GRAVA (o resultado da consulta
 * vira cache no próprio lead). Gravação atrás de POST com conferência de
 * origem é a regra da casa.
 *
 * Nunca devolve erro por causa do WTS. Lead que não pôde ser conferido volta
 * como "nao_conferido" com o detalhe, e a lista segue de pé: a coluna de
 * atendimento é informação a mais, não pode virar motivo para o vendedor
 * ficar sem a fila dele.
 */
export async function POST(request: Request): Promise<Response> {
  // Painel é interno: sem sessão, nada é lido nem gravado.
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;

  // Grava no banco e gasta cota do WTS: mesma conferência de origem dos
  // outros POST do painel.
  const forasteiro = exigirOrigemConfiavel(request);
  if (forasteiro) return forasteiro;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erro("json invalido", 400);
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
    return erro("json invalido", 400);
  }

  const leadIds = lerLeadIds((corpo as Record<string, unknown>).leadIds, TETO_POR_CHAMADA);
  if (!leadIds) {
    return erro(`leadIds invalido: lista de ids unicos, de 1 ate ${TETO_POR_CHAMADA}`, 400);
  }

  const sb = getSupabase();

  // Config ilegível não pode derrubar a consulta: a janela de recência tem um
  // padrão no código justamente para a guarda nunca ficar sem critério (ver
  // JANELA_CONVERSA_PADRAO_DIAS).
  const { data: cfg } = await sb
    .from("portais_config")
    .select("*")
    .eq("cliente_slug", CLIENTE_SLUG)
    .single();

  const deps: DepsAtendimento = {
    lerLeads: async (ids) => {
      // `select("*")` de propósito: as colunas de conversa podem ainda não
      // existir (migration não rodou), e pedi-las pelo nome faria o PostgREST
      // devolver erro em vez de simplesmente não trazer o campo.
      const { data, error } = await sb.from("portais_leads").select("*").in("id", ids);
      if (error) throw new Error(error.message);
      return (data ?? []) as LeadParaAtendimento[];
    },
    consultar: consultarConversaNoWts,
    gravar: async (leadId, campos) => {
      const { data, error } = await sb
        .from("portais_leads")
        .update(campos)
        .eq("id", leadId)
        .select("id");
      if (error) throw new Error(error.message);
      // PostgREST devolve 200 com lista vazia quando a linha não existe (ou a
      // RLS barrou): conferir a linha de volta é a única forma de saber que
      // gravou. Mesma cicatriz de processar.ts, ativacao.ts e fila.ts.
      if (!data || data.length === 0) throw new Error(`lead ${leadId} nao atualizado`);
    },
    agora: () => new Date(),
    janelaDias: janelaConversaDias((cfg as { janela_conversa_dias?: unknown } | null)?.janela_conversa_dias),
  };

  try {
    return json(await atualizarAtendimento(leadIds, deps));
  } catch (e) {
    // Só chega aqui o que é do BANCO (a leitura dos leads). Falha de WTS e
    // falha de gravação são tratadas lead a lead lá dentro.
    return erro(e instanceof Error && e.message ? e.message : "falha ao conferir atendimento", 500);
  }
}
