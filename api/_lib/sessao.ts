import { createHmac, timingSafeEqual } from "node:crypto";
import { erro, lerCookie } from "./http.js";

export const COOKIE_ADMIN = "portais_admin";
const DURACAO_MS = 12 * 60 * 60 * 1000;

/**
 * Cookie de sessão assinado com HMAC, no mesmo desenho de app-objecoes
 * (api/_lib/sessao.ts): o payload é só o instante de expiração, e a
 * assinatura é o que impede o visitante de escrever a própria validade.
 * Não há tabela de sessão — não precisa: o segredo mora no ambiente e o
 * cookie se valida sozinho.
 */
export function assinarSessao(expiraEm: number, segredo: string): string {
  const payload = String(expiraEm);
  const assinatura = createHmac("sha256", segredo).update(payload).digest("hex");
  return `${payload}.${assinatura}`;
}

export function sessaoValida(cookie: string | null, segredo: string, agora = Date.now()): boolean {
  if (!cookie) return false;

  const partes = cookie.split(".");
  if (partes.length !== 2) return false;
  const [payload, assinatura] = partes;
  if (!/^\d+$/.test(payload) || !/^[0-9a-f]{64}$/.test(assinatura)) return false;

  const esperada = createHmac("sha256", segredo).update(payload).digest("hex");
  if (!iguais(assinatura, esperada)) return false;

  return Number(payload) > agora;
}

/**
 * SameSite=None porque o painel roda embedado num iframe do AIOS, e navegador
 * nenhum devolve cookie Strict (nem Lax) numa requisição feita dentro de um
 * iframe de outro site. Com Strict, o login gravava o cookie e toda chamada
 * seguinte voltava 401, para sempre. `None` é o único valor que funciona ali,
 * e exige `Secure` (que já estava).
 *
 * `None` também faz o navegador mandar o cookie junto de requisições
 * disparadas por qualquer página da internet, o que abre CSRF. Isso não fica
 * em branco: quem paga essa conta é exigirOrigemConfiavel (origem.ts), nos
 * endpoints que mudam estado.
 */
export function cabecalhoSessao(segredo: string): string {
  const cookie = assinarSessao(Date.now() + DURACAO_MS, segredo);
  return `${COOKIE_ADMIN}=${cookie}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${DURACAO_MS / 1000}`;
}

/**
 * Guarda das rotas do painel. Devolve a resposta de barrado, ou null se pode
 * passar. Sem ela, um GET anônimo em /api/leads devolve nome, telefone,
 * e-mail e a mensagem escrita pelo lead — o oposto da decisão D2 da spec
 * ("ler tudo, guardar só o que é portal", justificada por proteção de dados).
 */
export function exigirAdmin(request: Request): Response | null {
  const segredo = process.env.ADMIN_SESSION_SECRET;
  // Fail-closed: segredo ausente é erro de configuração, e erro de
  // configuração nunca pode virar porta aberta.
  if (!segredo) return erro("painel nao configurado", 500);
  if (!sessaoValida(lerCookie(request, COOKIE_ADMIN), segredo)) {
    return erro("nao autorizado", 401);
  }
  return null;
}

/**
 * Guarda do cron. Segredo próprio, e não a sessão do painel, porque quem
 * chama é a Vercel e não um humano: ela manda `Authorization: Bearer
 * $CRON_SECRET` quando a variável existe no projeto. Sem isso, qualquer um
 * dispara a varredura da caixa de e-mail da cliente pela URL.
 */
export function exigirCron(request: Request): Response | null {
  const segredo = process.env.CRON_SECRET;
  if (!segredo) return erro("cron nao configurado", 500);

  const cabecalho = request.headers.get("authorization") ?? "";
  const prefixo = "Bearer ";
  if (!cabecalho.startsWith(prefixo) || !iguais(cabecalho.slice(prefixo.length), segredo)) {
    return erro("nao autorizado", 401);
  }
  return null;
}

/**
 * Comparação em tempo constante. timingSafeEqual estoura com tamanhos
 * diferentes, então o tamanho é conferido antes — é a única informação que
 * este caminho vaza, e ela não ajuda quem tenta adivinhar o segredo.
 *
 * Exportada porque api/sessao.ts compara a chave do embed com a mesma regra:
 * segredo conferido por comparação ingênua vaza o prefixo certo no tempo de
 * resposta, e isso vale tanto aqui quanto lá.
 */
export function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
