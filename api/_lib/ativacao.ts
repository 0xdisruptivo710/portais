import type { ModoEnvio } from "../../src/tipos.js";
import { getSupabase } from "./supabase.js";
import { decidirSupressao } from "./supressao.js";
import { montarEnvio, montarTexto, wtsRequest } from "./wts.js";

export type Acao = "dry_run" | "suprimido" | "adiar" | "enviar";

export interface Janela {
  horarioInicio: string;
  horarioFim: string;
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
  a: { modo: ModoEnvio; suprimir: boolean; motivo: string | null; agora?: Date } & Janela,
): Acao {
  if (a.suprimir) return "suprimido";
  if (a.modo !== "real") return "dry_run";
  return dentroDaJanela(a.agora ?? new Date(), a) ? "enviar" : "adiar";
}

export async function ativarLead(leadId: number): Promise<Acao> {
  const sb = getSupabase();

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

  // Lead sem telefone normalizável nunca pode chegar ao ramo de envio: o
  // normalizador (telefone.ts) devolve null de propósito quando o número é
  // ambíguo, em vez de adivinhar. Essa checagem tem que vir ANTES da busca de
  // supressão abaixo — `.eq("telefone_e164", null)` não casa com nada em SQL,
  // então rodar essa consulta pra um lead sem telefone só mascararia o motivo
  // real com um "sem supressão" incorreto.
  let suprimir: boolean;
  let motivo: string | null;
  if (!lead.telefone_e164) {
    suprimir = true;
    motivo = "sem telefone normalizavel";
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

    ({ suprimir, motivo } = decidirSupressao({
      ultimoContatoEm: anteriores?.[0]?.enviado_em ? new Date(anteriores[0].enviado_em) : null,
      janelaDias: cfg.janela_supressao_dias,
      agora: new Date(),
      killSwitch: cfg.kill_switch,
    }));
  }

  const acao = decidirAcao({
    modo: cfg.modo_envio,
    suprimir,
    motivo,
    horarioInicio: cfg.horario_inicio,
    horarioFim: cfg.horario_fim,
  });

  const texto = montarTexto(cfg.texto_boas_vindas, {
    nome: primeiroNome(lead.nome),
    veiculo: lead.veiculo_texto,
    portal: rotuloPortal(lead.portal),
  });

  const payload = lead.telefone_e164
    ? montarEnvio({ texto, from: cfg.wts_from ?? "", e164: lead.telefone_e164 })
    : null;

  // A linha de auditoria é gravada SEMPRE, inclusive quando nada sai. É ela
  // que responde depois "por que esse lead não recebeu mensagem".
  const { data: ativacao } = await sb
    .from("portais_ativacoes")
    .insert({
      lead_id: leadId,
      modo: cfg.modo_envio,
      payload_enviado: payload,
      erro: acao === "suprimido" ? motivo : acao === "adiar" ? "fora da janela" : null,
    })
    .select("id");

  if (!ativacao || ativacao.length === 0) {
    throw new Error("insert em portais_ativacoes nao devolveu linha");
  }

  if (acao !== "enviar") {
    await atualizarLead(sb, leadId, {
      status_ativacao: acao === "suprimido" ? "suprimido" : "dry_run",
      motivo_supressao: acao === "suprimido" ? motivo : null,
    });
    return acao;
  }

  // Daqui para baixo só roda com modo_envio = 'real'.
  const resposta = await wtsRequest("POST", "/chat/v1/message/send", payload);
  await sb.from("portais_ativacoes")
    .update({ resposta_wts: resposta })
    .eq("id", ativacao[0].id);
  await atualizarLead(sb, leadId, { status_ativacao: "enviado", enviado_em: new Date().toISOString() });
  return "enviar";
}

/**
 * PostgREST devolve HTTP 200 com lista vazia quando o "id" não existe — a
 * mesma cicatriz do insert em portais_ativacoes (e de marcar()/gravarLead()
 * em processar.ts). Conferir a linha de volta é a única forma de saber que o
 * update gravou de verdade, não só que a chamada não deu erro.
 */
async function atualizarLead(
  sb: ReturnType<typeof getSupabase>,
  leadId: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await sb.from("portais_leads").update(payload).eq("id", leadId).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(`update em portais_leads nao devolveu linha (lead ${leadId})`);
  }
}

function primeiroNome(nome: string | null): string | null {
  return nome?.trim().split(/\s+/)[0] ?? null;
}

const ROTULOS: Record<string, string> = {
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
