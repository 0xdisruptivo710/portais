import { ativarLeadDetalhado, dentroDaJanela } from "../_lib/ativacao.js";
import { erro, json } from "../_lib/http.js";
import { executarFatia, lerLeadIds, TETO_POR_LOTE, type DepsLote } from "../_lib/lote.js";
import { exigirOrigemConfiavel } from "../_lib/origem.js";
import { exigirAdmin } from "../_lib/sessao.js";
import { getSupabase } from "../_lib/supabase.js";

// Único cliente ativo por enquanto (mesmo hardcode de config.ts).
const CLIENTE_SLUG = "malentachi";

/**
 * POST /api/lote/enviar: UMA FATIA do lote, não o lote inteiro.
 *
 * Este é o endpoint mais perigoso do sistema: atrás dele saem mensagens de
 * WhatsApp para clientes reais, e não existe desfazer. Três decisões
 * sustentam o desenho:
 *
 * 1. A requisição processa poucos leads e devolve `restantes`. A function da
 *    Vercel morre aos 300s e um lote com espaçamento não cabe lá dentro.
 *    Quem emenda as fatias é o navegador, chamando de novo com o que sobrou —
 *    e é isso que também dá ao operador um botão "Parar" que vale alguma
 *    coisa: basta não pedir a próxima fatia.
 *
 * 2. A retomada é idempotente pelo estado do próprio lead. Timeout, aba
 *    fechada, rede caindo: retomar com a mesma lista não repete mensagem,
 *    porque quem já recebeu tem `enviado_em` gravado e é pulado (ver
 *    executarFatia). Nenhum contador em memória participa dessa conta.
 *
 * 3. Todas as guardas por lead continuam valendo, uma por uma, e nenhuma é
 *    pulada em nome de performance: kill-switch, telefone ausente, remetente
 *    ausente, texto vazio, janela de recontato e a consulta de conversa
 *    aberta no WTS. O lote NUNCA força a guarda de conversa aberta — forçar é
 *    decisão de quem está olhando para aquele lead, e no lote ninguém está.
 *
 * Diferente do envio de um lead só, o lote respeita a janela de horário. O
 * botão de um lead dispensa a janela porque existe uma pessoa olhando para
 * ele naquele instante; um lote roda por muitos minutos e atravessa a noite,
 * e quem clicou às 19h50 não autorizou mensagem às 21h. Fora da janela nada
 * sai e a lista volta intacta, para o operador retomar no dia seguinte.
 */
export async function POST(request: Request): Promise<Response> {
  // A guarda mais importante do arquivo.
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;

  // SameSite=None manda o cookie junto de requisicao disparada por qualquer
  // pagina. Sem esta conferencia, uma pagina maliciosa aberta no navegador do
  // operador dispararia um lote inteiro.
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

  // O teto do lote é conferido AQUI, no servidor, e não só na tela: a tela
  // pode ser contornada, o número de mensagens que saem não.
  const leadIds = lerLeadIds((corpo as Record<string, unknown>).leadIds, TETO_POR_LOTE);
  if (!leadIds) {
    return erro(`leadIds invalido: lista de ids unicos, de 1 ate ${TETO_POR_LOTE} por lote`, 400);
  }

  const sb = getSupabase();

  const { data: cfg } = await sb
    .from("portais_config")
    .select("*")
    .eq("cliente_slug", CLIENTE_SLUG)
    .single();
  if (!cfg) return erro("config do cliente ausente", 500);

  const agora = new Date();
  const janela = {
    horarioInicio: String(cfg.horario_inicio ?? "08:00"),
    horarioFim: String(cfg.horario_fim ?? "20:00"),
  };
  if (!dentroDaJanela(agora, janela)) {
    // 200, e não erro: não é falha, é decisão. A lista volta inteira e o
    // operador retoma dentro do horário, com a mesma seleção.
    return json({ resultados: [], restantes: leadIds, parado: "fora_da_janela" });
  }

  const deps: DepsLote = {
    // Autorização humana para ESTES leads, nesta chamada. Sem
    // ignorarConversaAberta: no lote ninguém está lendo o motivo.
    ativar: (leadId) => ativarLeadDetalhado(leadId, { autorizadoManualmente: true }),
    jaEnviado: async (leadId) => {
      const { data, error } = await sb
        .from("portais_leads")
        .select("enviado_em")
        .eq("id", leadId)
        .single();
      if (error) throw new Error(error.message);
      const valor = (data as { enviado_em?: string | null } | null)?.enviado_em;
      return typeof valor === "string" && valor.length > 0 ? valor : null;
    },
    dormir: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
    agora: () => Date.now(),
  };

  const fatia = await executarFatia(leadIds, deps);
  return json(fatia);
}
