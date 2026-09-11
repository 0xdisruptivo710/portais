import { ativarLeadDetalhado, previaDeEnvio } from "./_lib/ativacao.js";
import { erro, json } from "./_lib/http.js";
import { exigirAdmin } from "./_lib/sessao.js";
import { ErroWts } from "./_lib/wts.js";

/**
 * O envio de UM lead, autorizado por um humano que está olhando para ele.
 *
 * GET devolve a prévia (o texto exato, o destino e o aviso de reincidência)
 * para a tela mostrar ANTES de o operador confirmar. POST dispara.
 *
 * Este endpoint não muda `modo_envio`: a config do cliente continua como
 * estava, e a autorização vale só para a chamada. É de propósito que não
 * existe caminho de lote aqui — um lead por vez, com confirmação, é a
 * diferença entre uma mensagem errada e duzentas.
 */
export async function GET(request: Request): Promise<Response> {
  // Painel é interno: sem sessão, nada é lido nem gravado. Esta é a guarda
  // mais importante do arquivo — atrás dela existe um POST que fala com
  // cliente real.
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;

  const url = new URL(request.url);
  const leadId = lerLeadId(url.searchParams.get("leadId"));
  if (leadId === null) return erro("leadId invalido", 400);

  try {
    const previa = await previaDeEnvio(leadId);
    return json({
      texto: previa.texto,
      telefone_exibicao: previa.telefoneExibicao,
      para: previa.para,
      bloqueado: previa.bloqueado,
      motivo: previa.motivo,
      ultimo_contato_em: previa.ultimoContatoEm,
      dias_desde_ultimo_contato: previa.diasDesdeUltimoContato,
    });
  } catch (e) {
    return erro(mensagem(e, "falha ao montar a previa do envio"), 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  // Mesma guarda do GET: sessão é a primeira coisa, antes de tocar no banco.
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erro("json invalido", 400);
  }
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
    return erro("json invalido", 400);
  }

  const leadId = lerLeadId((corpo as Record<string, unknown>).leadId);
  if (leadId === null) return erro("leadId invalido", 400);

  let resultado;
  try {
    // A autorização humana vale para ESTE lead e só nesta chamada. Todas as
    // guardas de ativacao.ts continuam valendo, em especial a supressão.
    resultado = await ativarLeadDetalhado(leadId, { autorizadoManualmente: true });
  } catch (e) {
    // Erro vindo do WTS é problema de gateway, não do painel: 502 separa
    // "a mensagem não saiu porque o WTS recusou" de "o painel quebrou".
    if (e instanceof ErroWts) return erro(mensagem(e, "o WTS recusou o envio"), 502);
    return erro(mensagem(e, "falha ao enviar"), 500);
  }

  // O corpo abaixo é o que o operador vai ler na tela, então ele não pode
  // arredondar nada para cima. Em especial: `enviado` diz que o POST de
  // envio foi aceito pelo WTS, e NÃO que a mensagem chegou ao destinatário —
  // quem responde isso é `verificado`, que só fica true com prova.
  return json({
    acao: resultado.acao,
    enviado: resultado.acao === "enviar",
    motivo: resultado.motivo,
    resposta_wts: resultado.respostaWts,
    verificado: resultado.verificado,
    verificacao_detalhe: resultado.verificacaoDetalhe,
  });
}

/**
 * Aceita o id vindo da query (string) ou do corpo JSON (número). Number("")
 * é 0 e Number(null) é 0, então a checagem de inteiro positivo é o que
 * impede um parâmetro ausente de virar uma consulta ao lead de id 0.
 */
function lerLeadId(bruto: unknown): number | null {
  if (bruto === null || bruto === undefined || bruto === "") return null;
  const n = Number(bruto);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function mensagem(e: unknown, padrao: string): string {
  return e instanceof Error && e.message ? e.message : padrao;
}
