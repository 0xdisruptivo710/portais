import { PORTAIS } from "../src/tipos.js";
import { erro, json } from "./_lib/http.js";
import { getSupabase } from "./_lib/supabase.js";

const DIAS_PADRAO = 30;

interface NumerosPortal {
  total: number;
  parser: number;
  revisao: number;
  temposContatoMin: number[];
}

/**
 * GET /api/numeros?dias=<n>: as três métricas da spec do painel (seção
 * Números) — leads por portal por dia, taxa de identificação automática e
 * tempo até o primeiro contato — mais revisão, que já existia.
 *
 * `total`, `taxa_identificacao`, `revisao` e o tempo de contato são
 * vitalícios (não respeitam `dias`): são o placar de desempenho geral do
 * portal. Só a série diária (`serie_diaria`) é recortada por `dias` —
 * é ela que responde "esse portal secou ou disparou nas últimas semanas",
 * pergunta que um total vitalício não responde. Tudo agregado em memória, a
 * partir de uma única leitura de portais_leads: o volume desta base não
 * justifica RPC nem uma segunda consulta filtrada por data.
 */
export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dias = Math.max(1, Number(url.searchParams.get("dias") ?? String(DIAS_PADRAO)) || DIAS_PADRAO);
  const desde = Date.now() - dias * 24 * 60 * 60 * 1000;

  const sb = getSupabase();

  const { data: leads, error: erroLeads } = await sb
    .from("portais_leads")
    .select("portal,metodo,capturado_em,enviado_em");
  if (erroLeads) return erro(erroLeads.message, 500);

  const { data: eventos, error: erroEventos } = await sb
    .from("portais_eventos_raw")
    .select("portal")
    .eq("status", "revisao");
  if (erroEventos) return erro(erroEventos.message, 500);

  const porPortal = new Map<string, NumerosPortal>();
  for (const portal of PORTAIS) porPortal.set(portal, { total: 0, parser: 0, revisao: 0, temposContatoMin: [] });

  // Chave composta "data|portal": um Map só dá pra agrupar por um valor,
  // então a dupla vira uma string pra não colidir portais no mesmo dia.
  const serieMapa = new Map<string, number>();

  for (const l of leads ?? []) {
    const acumulado = porPortal.get(l.portal) ?? { total: 0, parser: 0, revisao: 0, temposContatoMin: [] };
    acumulado.total++;
    if (l.metodo === "parser") acumulado.parser++;
    // Leads sem enviado_em ainda não foram contatados: fora do cálculo do
    // tempo de contato, senão "nunca contatado" contaria como "contato
    // instantâneo" (capturado_em - capturado_em = 0).
    if (l.enviado_em) {
      acumulado.temposContatoMin.push((new Date(l.enviado_em).getTime() - new Date(l.capturado_em).getTime()) / 60_000);
    }
    porPortal.set(l.portal, acumulado);

    const dataCaptura = new Date(l.capturado_em).getTime();
    if (dataCaptura >= desde) {
      const chave = `${diaSaoPaulo(l.capturado_em)}|${l.portal}`;
      serieMapa.set(chave, (serieMapa.get(chave) ?? 0) + 1);
    }
  }
  for (const e of eventos ?? []) {
    const acumulado = porPortal.get(e.portal) ?? { total: 0, parser: 0, revisao: 0, temposContatoMin: [] };
    acumulado.revisao++;
    porPortal.set(e.portal, acumulado);
  }

  const itens = [...porPortal.entries()].map(([portal, v]) => ({
    portal,
    total: v.total,
    taxa_identificacao: v.total === 0 ? 0 : v.parser / v.total,
    revisao: v.revisao,
    tempo_mediano_primeiro_contato_min: mediana(v.temposContatoMin),
  }));

  const serie_diaria = [...serieMapa.entries()]
    .map(([chave, total]) => {
      const [data, portal] = chave.split("|");
      return { data, portal, total };
    })
    .sort((a, b) => (a.data === b.data ? a.portal.localeCompare(b.portal) : a.data.localeCompare(b.data)));

  return json({ dias, itens, serie_diaria });
}

/**
 * YYYY-MM-DD no fuso de São Paulo, não no fuso do servidor (mesma regra de
 * ativacao.ts): a Vercel roda em UTC, e sem isso um lead capturado de
 * madrugada em SP cairia no dia seguinte na série.
 */
function diaSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

/**
 * Mediana, não média: tempo até contato tem cauda longa (um lead esquecido
 * por dias puxa a média pra cima e escondia o "normal" do portal). Só entra
 * quem já foi contatado — sem lead contatado, null, nunca NaN.
 */
function mediana(valoresMin: number[]): number | null {
  if (valoresMin.length === 0) return null;
  const ordenado = [...valoresMin].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  const valor = ordenado.length % 2 === 0 ? (ordenado[meio - 1] + ordenado[meio]) / 2 : ordenado[meio];
  return Math.round(valor);
}
