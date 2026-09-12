import { erro, json } from "./_lib/http.js";
import { exigirOrigemConfiavel } from "./_lib/origem.js";
import { exigirAdmin } from "./_lib/sessao.js";
import { getSupabase } from "./_lib/supabase.js";
import { paraE164, paraExibicao } from "./_lib/telefone.js";

/**
 * GET lista a fila de revisão humana: eventos que nem o parser nem a IA
 * conseguiram interpretar (ver processar.ts). POST completa a revisão,
 * gravando o lead com os dados que a pessoa digitou e tirando o evento
 * da fila. É a rede de segurança que garante que nenhum lead se perde
 * quando a interpretação automática falha.
 */
export async function GET(request: Request): Promise<Response> {
  // Painel é interno: sem sessão, nada é lido nem gravado. Os GET daqui
  // devolvem nome, telefone, e-mail e a mensagem escrita pelo lead.
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;
  return listar();
}

export async function POST(request: Request): Promise<Response> {
  // Mesma guarda do GET: sessão é a primeira coisa, antes de tocar no banco.
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;

  // SameSite=None manda o cookie junto de requisicao disparada por qualquer
  // pagina. A sessao sozinha nao prova mais que quem pediu foi o painel.
  const forasteiro = exigirOrigemConfiavel(request);
  if (forasteiro) return forasteiro;

  return completar(request);
}

async function listar(): Promise<Response> {
  const { data, error } = await getSupabase()
    .from("portais_eventos_raw")
    .select("id,portal,assunto,remetente,recebido_em,corpo_texto,corpo_html")
    .eq("status", "revisao")
    .order("recebido_em", { ascending: false });

  if (error) return erro(error.message, 500);
  return json({ itens: data ?? [] });
}

async function completar(request: Request): Promise<Response> {
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erro("json invalido", 400);
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
    return erro("json invalido", 400);
  }

  const bruto = corpo as Record<string, unknown>;
  const eventoId = Number(bruto.evento_id);
  if (!Number.isInteger(eventoId) || eventoId <= 0) return erro("evento_id invalido", 400);

  const sb = getSupabase();
  const { data: evento, error: erroEvento } = await sb
    .from("portais_eventos_raw")
    .select("id,portal")
    .eq("id", eventoId)
    .single();
  if (erroEvento || !evento) return erro("evento nao encontrado", 404);

  const nome = typeof bruto.nome === "string" ? bruto.nome.trim() || null : null;
  const e164 = paraE164(typeof bruto.telefone === "string" ? bruto.telefone : null);
  const veiculoTexto = typeof bruto.veiculo_texto === "string" ? bruto.veiculo_texto : null;
  const email = typeof bruto.email === "string" ? bruto.email : null;
  const mensagemLead = typeof bruto.mensagem_lead === "string" ? bruto.mensagem_lead : null;

  const { data: leadGravado, error: erroLead } = await sb
    .from("portais_leads")
    .upsert(
      {
        evento_id: eventoId,
        cliente_slug: "malentachi",
        portal: evento.portal,
        nome,
        telefone_e164: e164,
        telefone_exibicao: paraExibicao(e164),
        email,
        veiculo_texto: veiculoTexto,
        mensagem_lead: mensagemLead,
        capturado_em: new Date().toISOString(),
        confianca: "alta",
        metodo: "manual",
        status_ativacao: "pendente",
      },
      // Deliberado: permite revisar o mesmo evento de novo (correção de
      // digitação) sem criar lead duplicado. Mesmo padrão de processar.ts.
      { onConflict: "evento_id" },
    )
    .select("id");
  if (erroLead) return erro(erroLead.message, 500);
  if (!leadGravado || leadGravado.length === 0) return erro("lead nao gravado", 500);

  // PostgREST devolve 200 com lista vazia quando a linha não existe: conferir
  // a linha de volta é a única forma de saber que o evento saiu da fila.
  const { data: eventoAtualizado, error: erroUpdate } = await sb
    .from("portais_eventos_raw")
    .update({ status: "parseado", processado_em: new Date().toISOString() })
    .eq("id", eventoId)
    .select("id");
  if (erroUpdate) return erro(erroUpdate.message, 500);
  if (!eventoAtualizado || eventoAtualizado.length === 0) {
    return erro(`evento ${eventoId} nao atualizado`, 500);
  }

  return json({ id: leadGravado[0].id }, 201);
}
