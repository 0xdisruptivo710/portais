import { erro } from "./_lib/http.js";
import { exigirOrigemConfiavel } from "./_lib/origem.js";
import { cabecalhoSessao, iguais } from "./_lib/sessao.js";

/**
 * POST /api/sessao: troca a chave do embed pelo cookie de sessão que as
 * rotas do painel exigem.
 *
 * Este painel não tem usuários nem senha. Quem controla o acesso é o CRM do
 * cliente (o AIOS), que embeda a ferramenta como
 * `<iframe src="https://.../?k=<EMBED_TOKEN>">`. O front lê o `k` da URL e
 * troca aqui por uma sessão de 12h. A chave fica no src do iframe, então um
 * reload refaz a troca sozinho, sem ninguém digitar nada.
 *
 * Por que não deixar a chave valendo direto como credencial de cada
 * chamada: ela viajaria na query string de toda requisição, e query string
 * entra em log de servidor, em Referer e no histórico. O cookie assinado
 * existe justamente para a chave aparecer uma vez e sair de cena.
 *
 * Toda recusa devolve a mesma resposta 401, sem distinguir "corpo
 * malformado" de "chave errada": diferenciar só ajudaria quem está tentando
 * adivinhar.
 */
export async function POST(request: Request): Promise<Response> {
  // Plantar cookie no navegador de quem está do outro lado também é mudar
  // estado, e o cookie é SameSite=None. A guarda vem antes de qualquer
  // leitura do corpo.
  const forasteiro = exigirOrigemConfiavel(request);
  if (forasteiro) return forasteiro;

  const chaveEsperada = process.env.EMBED_TOKEN;
  const segredo = process.env.ADMIN_SESSION_SECRET;
  // Fail-closed: sem as duas variáveis não existe acesso nenhum. Chave vazia
  // no ambiente não pode virar "qualquer um entra mandando string vazia".
  if (!chaveEsperada || !segredo) return erro("painel nao configurado", 500);

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erro("nao autorizado", 401);
  }
  if (typeof corpo !== "object" || corpo === null) return erro("nao autorizado", 401);

  const chave = (corpo as Record<string, unknown>).chave;
  if (typeof chave !== "string" || !iguais(chave, chaveEsperada)) {
    return erro("nao autorizado", 401);
  }

  return new Response(null, {
    status: 204,
    headers: { "set-cookie": cabecalhoSessao(segredo) },
  });
}
