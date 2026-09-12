import type { EmailCru, LeadBruto, Portal } from "../../src/tipos.js";
import { PORTAIS_COM_DADOS } from "../../src/tipos.js";
import { getSupabase } from "./supabase.js";
import { parserDoPortal } from "./parsers/index.js";
import { extrairComIa } from "./ia.js";
import { ehLead } from "./ehLead.js";
import { paraE164, paraExibicao } from "./telefone.js";
import { casarComEstoque } from "./estoque.js";
import { definirVendedor } from "./vendedores.js";

export type ResultadoProcesso = "lead" | "revisao" | "sem_dados" | "ignorado";

/**
 * Pipeline de interpretação de um evento cru já gravado no banco. Decide
 * entre lead com dados, lead sem dados (OLX e Mercado Livre só mandam botão),
 * fila de revisão humana (parser e IA falharam os dois) — a rede de segurança
 * que garante que nenhum lead se perde — e propaga erro em vez de engolir.
 */
export async function processarEvento(eventoId: number): Promise<ResultadoProcesso> {
  const sb = getSupabase();
  const { data: ev, error } = await sb
    .from("portais_eventos_raw")
    .select("*")
    .eq("id", eventoId)
    .single();
  if (error || !ev) throw new Error(error?.message ?? "evento nao encontrado");

  const portal = ev.portal as Portal;
  const email: EmailCru = {
    messageId: ev.message_id,
    remetente: ev.remetente ?? "",
    assunto: ev.assunto ?? "",
    recebidoEm: ev.recebido_em,
    texto: ev.corpo_texto ?? "",
    html: ev.corpo_html ?? "",
    anexos: (ev.anexos ?? []) as EmailCru["anexos"],
  };

  // Portão de assunto, antes de qualquer bifurcação e para todo portal:
  // fatura, propaganda, alerta de segurança e comunicado chegam do mesmo
  // remetente do lead. Sem isso, OLX e Mercado Livre (que não têm parser)
  // viravam "lead sem dados" com qualquer assunto, e um portal com parser
  // cujo assunto não é lead caía no fallback de IA, que inventa um nome.
  if (!ehLead(portal, email.assunto)) {
    await marcar(eventoId, "ignorado");
    return "ignorado";
  }

  // OLX e Mercado Livre só mandam botão. Vira card sem dados, com o link.
  if (!PORTAIS_COM_DADOS.includes(portal)) {
    await gravarLead(eventoId, portal, null, "baixa", "manual", ev.recebido_em);
    await marcar(eventoId, "parseado");
    return "sem_dados";
  }

  const parser = parserDoPortal(portal);
  let lead = parser ? parser(email) : null;
  let metodo: "parser" | "ia" = "parser";
  let custo = 0;

  if (!lead) {
    const cfg = await lerConfig();
    const gastoHoje = await gastoDeHoje();
    const r = await extrairComIa(email, {
      gastoHojeUsd: gastoHoje,
      tetoDiaUsd: cfg.ia_teto_dia_usd,
      tetoEventoUsd: cfg.ia_teto_evento_usd,
    });
    lead = r.lead;
    custo = r.custoUsd;
    metodo = "ia";
  }

  if (custo > 0) {
    await marcarCustoIa(eventoId, custo);
  }

  if (!lead) {
    await marcar(eventoId, "revisao");
    return "revisao";
  }

  await gravarLead(eventoId, portal, lead, metodo === "ia" ? "media" : "alta", metodo, ev.recebido_em);
  await marcar(eventoId, "parseado");
  return "lead";
}

async function marcar(eventoId: number, status: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from("portais_eventos_raw")
    .update({ status, processado_em: new Date().toISOString() })
    .eq("id", eventoId)
    .select("id");
  if (error) throw new Error(error.message);
  // PostgREST devolve 200 e lista vazia quando a linha não existe. Conferir a
  // linha de volta é a única forma de saber que gravou de verdade.
  if (!data || data.length === 0) throw new Error(`evento ${eventoId} nao atualizado`);
}

/**
 * Grava o custo da IA no evento. Mesma cicatriz do `marcar`: sem conferir a
 * linha de volta, um update que não acha o evento passa por "sucesso" e o
 * gasto de hoje some do cálculo do teto diário sem ninguém perceber.
 */
async function marcarCustoIa(eventoId: number, custoUsd: number): Promise<void> {
  const { data, error } = await getSupabase()
    .from("portais_eventos_raw")
    .update({ ia_usada: true, ia_custo_usd: custoUsd })
    .eq("id", eventoId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(`evento ${eventoId} nao atualizado (custo ia)`);
}

async function lerConfig() {
  const { data, error } = await getSupabase()
    .from("portais_config")
    .select("*")
    .eq("cliente_slug", "malentachi")
    .single();
  if (error || !data) throw new Error(error?.message ?? "config ausente");
  return data;
}

/** Soma do que a IA já gastou hoje, para o teto diário valer de fato. */
async function gastoDeHoje(): Promise<number> {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const { data, error } = await getSupabase()
    .from("portais_eventos_raw")
    .select("ia_custo_usd")
    .gte("created_at", inicio.toISOString());
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((s, r) => s + Number(r.ia_custo_usd ?? 0), 0);
}

async function gravarLead(
  eventoId: number,
  portal: Portal,
  lead: LeadBruto | null,
  confianca: "alta" | "media" | "baixa",
  metodo: "parser" | "ia" | "manual",
  recebidoEm: unknown,
): Promise<void> {
  const sb = getSupabase();

  const { data: estoque } = await sb
    .from("estoque_malentachi")
    .select("id,marca,modelo,ano,link");

  const e164 = paraE164(lead?.telefone ?? null);

  // Lead novo já nasce com dono. As duas regras moram em vendedores.ts: o
  // mesmo telefone volta para quem já falou com ele, e o resto entra no
  // rodízio da sua fila (ligar x abrir portal). Nunca lança: sem vendedor
  // ativo, ou com o banco fora do ar, volta null e o lead é gravado assim
  // mesmo — a ingestão não pode parar por causa da distribuição.
  const vendedor = await definirVendedor({
    clienteSlug: "malentachi",
    telefoneE164: e164,
    eventoId,
  });

  const { data, error } = await sb
    .from("portais_leads")
    .upsert(
      {
        evento_id: eventoId,
        cliente_slug: "malentachi",
        portal,
        vendedor,
        nome: lead?.nome ?? null,
        telefone_e164: e164,
        telefone_exibicao: paraExibicao(e164),
        email: lead?.email ?? null,
        veiculo_texto: lead?.veiculoTexto ?? null,
        estoque_id: casarComEstoque(lead?.veiculoTexto ?? null, lead?.anuncioUrl ?? null, estoque ?? []),
        anuncio_url: lead?.anuncioUrl ?? null,
        anuncio_id_externo: lead?.anuncioIdExterno ?? null,
        mensagem_lead: lead?.mensagemLead ?? null,
        capturado_em: dataCapturaEm(recebidoEm),
        confianca,
        metodo,
        status_ativacao: "pendente",
      },
      // Deliberado: permite reprocessar o mesmo evento (ex.: parser melhorou)
      // sem criar lead duplicado. Não trocar por insert.
      { onConflict: "evento_id" },
    )
    .select("id");

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(`lead do evento ${eventoId} nao gravado`);
}

/**
 * `capturado_em` tem que ser quando o e-mail chegou (recebido_em do evento),
 * não quando o nosso código processou. Ao vivo a diferença é de minutos e
 * passa despercebida; num backfill ela é o próprio motivo de existir da
 * série diária — sem isso, 90 dias de leads reais colapsam num único dia de
 * processamento. Guarda: e-mail sem data válida é raro, mas não pode travar
 * o processamento — cai no horário atual.
 */
function dataCapturaEm(recebidoEm: unknown): string {
  if (typeof recebidoEm === "string") {
    const data = new Date(recebidoEm);
    if (!Number.isNaN(data.getTime())) return data.toISOString();
  }
  return new Date().toISOString();
}
