import { dentroDaJanela } from "../_lib/ativacao.js";
import { erro, json } from "../_lib/http.js";
import {
  PAUSA_ENTRE_ENVIOS_MS,
  resumirLote,
  TETO_POR_LOTE,
  type ConfigDoLote,
  type LeadDoLote,
} from "../_lib/lote.js";
import { exigirOrigemConfiavel } from "../_lib/origem.js";
import { exigirAdmin } from "../_lib/sessao.js";
import { getSupabase } from "../_lib/supabase.js";

// Único cliente ativo por enquanto (mesmo hardcode de config.ts).
const CLIENTE_SLUG = "malentachi";

/**
 * Teto do que a prévia aceita contar. Bem acima do teto do lote de propósito:
 * a tela precisa poder dizer "217 selecionados, 60 entram neste lote" sem
 * recusar a pergunta. Existe só para uma lista absurda não virar consulta
 * absurda.
 */
const TETO_PREVIA = 500;

/** Páginas do `in(...)`: lista gigante vira URL gigante no PostgREST. */
const TAMANHO_PAGINA = 100;

/**
 * POST /api/lote/previa: a conta que o operador tem que olhar antes de
 * liberar um envio em lote.
 *
 * Não manda mensagem nenhuma e não toca a rede do WTS. Devolve quantas
 * mensagens devem sair, para quantas pessoas distintas, quantas já estão
 * bloqueadas (com o motivo agrupado), quantos leads ficaram acima do teto do
 * lote e quais ids formam ESTE lote — é essa lista que vai depois para
 * /api/lote/enviar, para a prévia e o envio falarem do mesmo conjunto.
 *
 * É POST, e não GET, por causa do tamanho da lista de ids: "todos os que o
 * filtro mostra" pode ser a base inteira, e isso não cabe com folga numa
 * query string. A guarda de origem vem junto pelo mesmo motivo dos outros
 * POST do painel.
 */
export async function POST(request: Request): Promise<Response> {
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;

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

  const leadIds = lerLeadIds((corpo as Record<string, unknown>).leadIds, TETO_PREVIA);
  if (!leadIds) return erro(`leadIds invalido: lista de ids, de 1 ate ${TETO_PREVIA}`, 400);

  const sb = getSupabase();

  const { data: cfg } = await sb
    .from("portais_config")
    .select("*")
    .eq("cliente_slug", CLIENTE_SLUG)
    .single();
  if (!cfg) return erro("config do cliente ausente", 500);

  let leads: LeadDoLote[];
  try {
    leads = await lerLeads(sb, leadIds);
  } catch (e) {
    return erro(e instanceof Error && e.message ? e.message : "falha ao ler os leads", 500);
  }

  // Ordem da tela, não a do banco: o corte do teto tem que pegar os primeiros
  // da lista que o operador está vendo. Id que não existe mais simplesmente
  // não entra, em vez de virar linha fantasma no lote.
  const porId = new Map(leads.map((l) => [l.id, l]));
  const ordenados = leadIds.map((id) => porId.get(id)).filter((l): l is LeadDoLote => l !== undefined);
  const doLote = ordenados.slice(0, TETO_POR_LOTE);

  let ultimoContatoPorTelefone: Map<string, string>;
  try {
    ultimoContatoPorTelefone = await lerUltimosContatos(sb, doLote);
  } catch (e) {
    return erro(e instanceof Error && e.message ? e.message : "falha ao ler os contatos", 500);
  }

  const agora = new Date();
  const resumo = resumirLote({
    leads: doLote,
    cfg: cfg as ConfigDoLote,
    ultimoContatoPorTelefone,
    agora,
  });

  return json({
    selecionados: leadIds.length,
    no_lote: doLote.length,
    acima_do_teto: Math.max(0, ordenados.length - doLote.length),
    teto: TETO_POR_LOTE,
    ids: doLote.map((l) => l.id),
    ...resumo,
    pausa_segundos: Math.round(PAUSA_ENTRE_ENVIOS_MS / 1000),
    janela: {
      aberta: dentroDaJanela(agora, {
        horarioInicio: String(cfg.horario_inicio ?? "08:00"),
        horarioFim: String(cfg.horario_fim ?? "20:00"),
      }),
      inicio: String(cfg.horario_inicio ?? "08:00").slice(0, 5),
      fim: String(cfg.horario_fim ?? "20:00").slice(0, 5),
    },
    // A conferência de conversa aberta no WTS custa duas chamadas por lead e
    // fica para a hora do envio. A tela precisa dizer isso, senão o operador
    // lê a prévia como palavra final.
    conversa_wts_confere_no_envio: true,
  });
}

/**
 * Lista de ids inteiros e positivos, sem repetição, dentro do teto. Number("")
 * é 0 e Number(null) é 0, então a checagem de inteiro positivo é o que impede
 * um item ausente de virar consulta ao lead de id 0.
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

async function lerLeads(sb: ReturnType<typeof getSupabase>, ids: number[]): Promise<LeadDoLote[]> {
  const leads: LeadDoLote[] = [];
  for (let i = 0; i < ids.length; i += TAMANHO_PAGINA) {
    const { data, error } = await sb
      .from("portais_leads")
      .select("id,portal,nome,veiculo_texto,telefone_e164,enviado_em")
      .in("id", ids.slice(i, i + TAMANHO_PAGINA));
    if (error) throw new Error(error.message);
    leads.push(...((data ?? []) as LeadDoLote[]));
  }
  return leads;
}

/**
 * Último contato por telefone, em TODO o cliente e não só nos leads do lote:
 * a janela de recontato existe para o lead que anuncia em três portais não
 * receber três "oi", e o contato anterior pode ter saído por outro lead.
 */
async function lerUltimosContatos(
  sb: ReturnType<typeof getSupabase>,
  leads: LeadDoLote[],
): Promise<Map<string, string>> {
  const telefones = [...new Set(leads.map((l) => l.telefone_e164).filter((t): t is string => !!t))];
  const ultimo = new Map<string, string>();

  for (let i = 0; i < telefones.length; i += TAMANHO_PAGINA) {
    const { data, error } = await sb
      .from("portais_leads")
      .select("telefone_e164,enviado_em")
      .eq("cliente_slug", CLIENTE_SLUG)
      .in("telefone_e164", telefones.slice(i, i + TAMANHO_PAGINA))
      .not("enviado_em", "is", null);
    if (error) throw new Error(error.message);

    for (const linha of (data ?? []) as { telefone_e164: string | null; enviado_em: string | null }[]) {
      if (!linha.telefone_e164 || !linha.enviado_em) continue;
      const atual = ultimo.get(linha.telefone_e164);
      // O MAIOR, não o primeiro que aparecer: a supressão decide pela última
      // vez que a pessoa foi abordada, não por uma vez qualquer.
      if (!atual || linha.enviado_em > atual) ultimo.set(linha.telefone_e164, linha.enviado_em);
    }
  }
  return ultimo;
}
