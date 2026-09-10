import { PORTAIS } from "../src/tipos.js";
import { erro, json } from "./_lib/http.js";
import { getSupabase } from "./_lib/supabase.js";

interface NumerosPortal {
  total: number;
  parser: number;
  revisao: number;
}

/**
 * GET /api/numeros: por portal, total de leads, taxa de identificação
 * automática (metodo='parser' sobre o total) e quantos foram para a fila de
 * revisão. Agregado em memória — o volume desta base não justifica RPC.
 */
export default async function handler(_request: Request): Promise<Response> {
  const sb = getSupabase();

  const { data: leads, error: erroLeads } = await sb.from("portais_leads").select("portal,metodo");
  if (erroLeads) return erro(erroLeads.message, 500);

  const { data: eventos, error: erroEventos } = await sb
    .from("portais_eventos_raw")
    .select("portal")
    .eq("status", "revisao");
  if (erroEventos) return erro(erroEventos.message, 500);

  const porPortal = new Map<string, NumerosPortal>();
  for (const portal of PORTAIS) porPortal.set(portal, { total: 0, parser: 0, revisao: 0 });

  for (const l of leads ?? []) {
    const acumulado = porPortal.get(l.portal) ?? { total: 0, parser: 0, revisao: 0 };
    acumulado.total++;
    if (l.metodo === "parser") acumulado.parser++;
    porPortal.set(l.portal, acumulado);
  }
  for (const e of eventos ?? []) {
    const acumulado = porPortal.get(e.portal) ?? { total: 0, parser: 0, revisao: 0 };
    acumulado.revisao++;
    porPortal.set(e.portal, acumulado);
  }

  const itens = [...porPortal.entries()].map(([portal, v]) => ({
    portal,
    total: v.total,
    taxa_identificacao: v.total === 0 ? 0 : v.parser / v.total,
    revisao: v.revisao,
  }));

  return json({ itens });
}
