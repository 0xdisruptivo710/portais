import { erro, json } from "./_lib/http.js";
import { exigirAdmin } from "./_lib/sessao.js";
import { listarVendedores } from "./_lib/vendedores.js";

// Único cliente ativo por enquanto (mesmo hardcode de config.ts e
// processar.ts). Quando existir mais de um, o slug vem de sessão/rota.
const CLIENTE_SLUG = "malentachi";

/**
 * GET /api/vendedores: quem está ativo no rodízio, na ordem cadastrada. É o
 * que a tela de Leads usa para montar o seletor de vendedor.
 *
 * Só os ativos: o seletor existe para escolher entre quem trabalha hoje.
 * Filtrar pelos leads de quem já saiu continua possível (o filtro de
 * /api/leads aceita o nome), mas isso é arqueologia, não operação do dia.
 *
 * `wts_user_id` fica de fora do que sai daqui: não serve para montar o
 * seletor e não tem por que viajar até o navegador.
 */
export async function GET(request: Request): Promise<Response> {
  // Painel é interno: sem sessão, nada é lido nem gravado.
  const barrado = exigirAdmin(request);
  if (barrado) return barrado;

  try {
    const vendedores = await listarVendedores(CLIENTE_SLUG, { apenasAtivos: true });
    return json({ itens: vendedores.map((v) => ({ id: v.id, nome: v.nome, ordem: v.ordem })) });
  } catch (e) {
    // Lista vazia por falha de banco viraria "não existe vendedor nenhum" na
    // tela, e o operador acharia que o cadastro sumiu.
    return erro(e instanceof Error && e.message ? e.message : "falha ao listar vendedores", 500);
  }
}
