import { PORTAIS, type Portal } from "../src/tipos.js";
import { erro, json } from "./_lib/http.js";
import { exigirAdmin } from "./_lib/sessao.js";
import { getSupabase } from "./_lib/supabase.js";
import { listarVendedores } from "./_lib/vendedores.js";

const LIMITE_PADRAO = 50;

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

  const pagina = Math.max(1, Number(url.searchParams.get("pagina") ?? "1") || 1);
  const inicio = (pagina - 1) * LIMITE_PADRAO;
  const fim = inicio + LIMITE_PADRAO - 1;

  const sb = getSupabase();
  let consulta = sb.from("portais_leads").select("*");
  if (portal) consulta = consulta.eq("portal", portal);
  if (vendedor) consulta = consulta.eq("vendedor", vendedor);
  const { data, error } = await consulta.order("created_at", { ascending: false }).range(inicio, fim);

  if (error) return erro(error.message, 500);
  return json({ itens: data ?? [] });
}
