import { erro, json } from "./_lib/http.js";
import { getSupabase } from "./_lib/supabase.js";

// Único cliente ativo por enquanto (mesmo hardcode de processar.ts). Quando
// existir mais de um cliente, o slug vem de sessão/rota, não daqui.
const CLIENTE_SLUG = "malentachi";

const MODOS_ENVIO = ["dry_run", "real"];

const CAMPOS = [
  "texto_boas_vindas",
  "wts_painel_id",
  "wts_coluna_id",
  "wts_from",
  "janela_supressao_dias",
  "horario_inicio",
  "horario_fim",
  "modo_envio",
  "kill_switch",
  "ia_teto_dia_usd",
  "ia_teto_evento_usd",
];

function peneirar(corpo: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = {};
  for (const campo of CAMPOS) if (corpo[campo] !== undefined) limpo[campo] = corpo[campo];
  return limpo;
}

/**
 * GET devolve a config do cliente. PUT atualiza. A validação de modo_envio é
 * a trava de segurança do sistema inteiro: só "dry_run" ou "real" passam, e
 * qualquer outro valor — typo, string vazia, número — devolve 400 em vez de
 * gravar. Um payload malformado nunca pode ligar envio real por acidente.
 * kill_switch é booleano puro pelo mesmo motivo: "true" (string) liga o
 * kill-switch por engano se não fosse recusado aqui.
 */
export default async function handler(request: Request): Promise<Response> {
  if (request.method === "GET") return buscar();
  if (request.method === "PUT") return atualizar(request);
  return erro("metodo nao permitido", 405);
}

async function buscar(): Promise<Response> {
  const { data, error } = await getSupabase()
    .from("portais_config")
    .select("*")
    .eq("cliente_slug", CLIENTE_SLUG)
    .single();

  if (error || !data) return erro("config nao encontrada", 404);
  return json(data);
}

async function atualizar(request: Request): Promise<Response> {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erro("json invalido", 400);
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
    return erro("json invalido", 400);
  }

  const dados = peneirar(corpo as Record<string, unknown>);

  if (dados.modo_envio !== undefined && !MODOS_ENVIO.includes(dados.modo_envio as string)) {
    return erro("modo_envio invalido: aceita apenas dry_run ou real", 400);
  }
  if (dados.kill_switch !== undefined && typeof dados.kill_switch !== "boolean") {
    return erro("kill_switch invalido: aceita apenas booleano", 400);
  }
  if (Object.keys(dados).length === 0) return erro("nada para atualizar", 400);

  const { data, error } = await getSupabase()
    .from("portais_config")
    .update(dados)
    .eq("cliente_slug", CLIENTE_SLUG)
    .select();

  if (error) return erro(error.message, 500);
  // RLS sem policy ou cliente_slug inexistente devolve 200 com zero linhas:
  // isso é falha, não sucesso.
  if (!data || data.length === 0) return erro("config nao gravada", 500);
  return json(data[0]);
}
