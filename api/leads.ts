import { PORTAIS, type Portal } from "../src/tipos.js";
import { erro, json } from "./_lib/http.js";
import { getSupabase } from "./_lib/supabase.js";

const LIMITE_PADRAO = 50;

/**
 * GET /api/leads?portal=<portal>&pagina=<n>. Lista os leads capturados,
 * mais recentes primeiro. `portal` é validado contra o catálogo antes de
 * chegar ao banco: repassar um valor qualquer pro PostgREST devolveria uma
 * lista vazia (portal inexistente) em vez do 400 que avisa quem chamou.
 */
export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const portal = url.searchParams.get("portal");
  if (portal !== null && !PORTAIS.includes(portal as Portal)) {
    return erro("portal invalido", 400);
  }

  const pagina = Math.max(1, Number(url.searchParams.get("pagina") ?? "1") || 1);
  const inicio = (pagina - 1) * LIMITE_PADRAO;
  const fim = inicio + LIMITE_PADRAO - 1;

  const sb = getSupabase();
  const consulta = sb.from("portais_leads").select("*");
  const filtrada = portal ? consulta.eq("portal", portal) : consulta;
  const { data, error } = await filtrada.order("created_at", { ascending: false }).range(inicio, fim);

  if (error) return erro(error.message, 500);
  return json({ itens: data ?? [] });
}
