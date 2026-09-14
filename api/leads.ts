import { PORTAIS, type Portal } from "../src/tipos.js";
import { janelaConversaDias } from "./_lib/conversa.js";
import { erro, json } from "./_lib/http.js";
import { exigirAdmin } from "./_lib/sessao.js";
import { getSupabase } from "./_lib/supabase.js";
import { listarVendedores } from "./_lib/vendedores.js";

const LIMITE_PADRAO = 50;

/**
 * Os três valores do filtro de atendimento. Não é um booleano de propósito:
 * três coisas diferentes se escondiam atrás de "não está em atendimento", e
 * só uma delas é fila limpa (ver EstadoAtendimento em _lib/atendimento.ts).
 * "sem_telefone" fica de fora porque não é fila de ninguém: é lead de portal
 * que só manda aviso, e o filtro de portal já dá conta dele.
 */
const ATENDIMENTOS = ["em_atendimento", "sem_conversa", "nao_conferido"];

// Único cliente ativo por enquanto (mesmo hardcode de config.ts e
// processar.ts). Quando existir mais de um, o slug vem de sessão/rota.
const CLIENTE_SLUG = "malentachi";

/**
 * GET /api/leads?portal=<portal>&vendedor=<nome>&pagina=<n>. Lista os leads
 * capturados, mais recentes primeiro.
 *
 * Os dois filtros são aplicados no BANCO, nunca em memória: filtrar do lado
 * do navegador sobre os 50 mais recentes esconde o lead que não couber nessa
 * primeira página — e o caso de uso do filtro de vendedor é justamente o
 * vendedor abrir o app e ver só o que é dele.
 *
 * Os dois também são validados contra um catálogo antes de chegar ao banco:
 * repassar um valor qualquer pro PostgREST devolveria uma lista vazia (que na
 * tela parece "esse vendedor não tem lead nenhum") em vez do 400 que avisa
 * quem chamou.
 */
export async function GET(request: Request): Promise<Response> {
  // Painel é interno: sem sessão, nada é lido nem gravado. Os GET daqui
  // devolvem nome, telefone, e-mail e a mensagem escrita pelo lead.
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;

  const url = new URL(request.url);
  const portal = url.searchParams.get("portal");
  if (portal !== null && !PORTAIS.includes(portal as Portal)) {
    return erro("portal invalido", 400);
  }

  const vendedor = url.searchParams.get("vendedor");
  if (vendedor !== null) {
    // Catálogo completo, não só os ativos: quem saiu continua tendo os leads
    // que já recebeu, e alguém precisa conseguir olhar para eles.
    let nomes: string[];
    try {
      nomes = (await listarVendedores(CLIENTE_SLUG, { apenasAtivos: false })).map((v) => v.nome);
    } catch (e) {
      return erro(e instanceof Error && e.message ? e.message : "falha ao conferir o vendedor", 500);
    }
    if (!nomes.includes(vendedor)) return erro("vendedor invalido", 400);
  }

  const atendimento = url.searchParams.get("atendimento");
  if (atendimento !== null && !ATENDIMENTOS.includes(atendimento)) {
    return erro("atendimento invalido", 400);
  }

  const pagina = Math.max(1, Number(url.searchParams.get("pagina") ?? "1") || 1);
  const inicio = (pagina - 1) * LIMITE_PADRAO;
  const fim = inicio + LIMITE_PADRAO - 1;

  const sb = getSupabase();
  let consulta = sb.from("portais_leads").select("*");
  if (portal) consulta = consulta.eq("portal", portal);
  if (vendedor) consulta = consulta.eq("vendedor", vendedor);
  if (atendimento) consulta = filtrarPorAtendimento(consulta, atendimento, await lerJanelaDias(sb));
  // Ordena por capturado_em (quando o e-mail chegou), nao por created_at
  // (quando a linha foi gravada). Os dois costumam coincidir a poucos
  // minutos, exceto depois de um resgate de Lixeira: ele grava lead de
  // meses atras com created_at de hoje. Se o corte de 50 desta pagina
  // (o LIMIT abaixo) continuasse olhando created_at, esse lote antigo podia
  // empurrar lead novo de verdade pra fora da primeira pagina - o oposto do
  // que a coluna Data do painel promete mostrar.
  const { data, error } = await consulta.order("capturado_em", { ascending: false }).range(inicio, fim);

  if (error) return erro(error.message, 500);
  return json({ itens: data ?? [] });
}

/**
 * A janela de recência do cliente, lida só quando o filtro de atendimento é
 * usado. Config ilegível não derruba a lista: `janelaConversaDias` já cai no
 * padrão do código, que é o mesmo que a guarda de envio usa.
 */
async function lerJanelaDias(sb: ReturnType<typeof getSupabase>): Promise<number> {
  const { data } = await sb
    .from("portais_config")
    .select("*")
    .eq("cliente_slug", CLIENTE_SLUG)
    .single();
  return janelaConversaDias((data as { janela_conversa_dias?: unknown } | null)?.janela_conversa_dias);
}

/**
 * O filtro de atendimento, aplicado no BANCO como os outros dois.
 *
 * O critério é a DATA da última mensagem comparada com a janela agora, nunca
 * um booleano gravado: é a mesma conta da guarda de envio (conversaEmAndamento
 * em _lib/conversa.ts), e é isso que impede a tela de dizer "em atendimento"
 * sobre um lead que o envio libera.
 *
 * "sem_conversa" exige `conversa_conferida_em` preenchido. Quem nunca foi
 * conferido não é fila limpa: é desconhecido, e prometer o contrário
 * devolveria ao vendedor a mesma fila suja de antes, com outro nome.
 */
function filtrarPorAtendimento<T extends ConsultaFiltravel>(consulta: T, atendimento: string, janelaDias: number): T {
  const corte = new Date(Date.now() - janelaDias * 86_400_000).toISOString();

  if (atendimento === "em_atendimento") {
    return consulta.gte("conversa_ultima_mensagem_em", corte) as T;
  }
  if (atendimento === "sem_conversa") {
    return consulta
      .not("conversa_conferida_em", "is", null)
      .or(`conversa_ultima_mensagem_em.is.null,conversa_ultima_mensagem_em.lt.${corte}`) as T;
  }
  // nao_conferido: só quem tem telefone, porque só esses são conferíveis. Sem
  // isso o filtro viraria uma lista de OLX e Mercado Livre, que nunca vão sair
  // de "não conferido".
  return consulta.not("telefone_e164", "is", null).is("conversa_conferida_em", null) as T;
}

/** Só os métodos que o filtro acima encadeia. O cliente do Supabase traz muito mais. */
interface ConsultaFiltravel {
  gte(coluna: string, valor: string): ConsultaFiltravel;
  not(coluna: string, operador: string, valor: unknown): ConsultaFiltravel;
  is(coluna: string, valor: unknown): ConsultaFiltravel;
  or(filtro: string): ConsultaFiltravel;
}
