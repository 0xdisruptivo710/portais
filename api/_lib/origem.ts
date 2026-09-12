import { erro } from "./http.js";

/**
 * Defesa de CSRF dos endpoints que mudam estado.
 *
 * Ela existe por causa do embed: o cookie de sessão precisa ser
 * `SameSite=None` para o navegador devolvê-lo dentro de um iframe de outro
 * site (ver cabecalhoSessao em sessao.ts). `None` é o único valor que
 * funciona ali, e é também o que faz o navegador mandar o cookie junto de
 * requisições disparadas por qualquer página da internet. Sem uma trava
 * própria, uma página maliciosa aberta no mesmo navegador do operador
 * conseguiria acionar POST /api/enviar, que manda WhatsApp para cliente
 * real.
 *
 * São duas camadas que se somam:
 *
 * 1. Origin. A requisição só passa se vier do próprio domínio do app ou de
 *    um domínio explicitamente liberado em ORIGENS_PERMITIDAS.
 * 2. content-type: application/json. Um formulário HTML de terceiro só
 *    consegue postar application/x-www-form-urlencoded, text/plain ou
 *    multipart/form-data. Para mandar JSON ele precisaria de fetch com
 *    header customizado, o que dispara preflight CORS, e o preflight morre
 *    porque este app não responde CORS para ninguém.
 *
 * A conferência de origem é FAIL-CLOSED, e isso não derruba nada: a origem
 * própria sai da requisição (URL e host), não de variável de ambiente.
 * ORIGENS_PERMITIDAS só ACRESCENTA domínios, e por isso pode não existir sem
 * consequência. Se a checagem fosse fail-open enquanto a variável não
 * existisse, o app ficaria com o cookie afrouxado e sem defesa nenhuma até
 * alguém lembrar de configurar. O erro caro é esse.
 */
export function exigirOrigemConfiavel(request: Request): Response | null {
  if (!ehJson(request.headers.get("content-type"))) {
    return erro("content-type precisa ser application/json", 415);
  }

  const origem = request.headers.get("origin");
  // Sem Origin também é recusa. Navegador manda Origin em toda requisição
  // que não é GET/HEAD, então quem escreve sem ele não é o painel.
  if (!origem) return erro("origem nao permitida", 403);

  const host = hostDaOrigem(origem);
  if (!host || !hostsPermitidos(request).includes(host)) {
    return erro("origem nao permitida", 403);
  }
  return null;
}

/** Só o tipo interessa: "application/json; charset=utf-8" é application/json. */
function ehJson(cabecalho: string | null): boolean {
  if (!cabecalho) return false;
  return cabecalho.split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * Host de um Origin de navegador. Origin é sempre `esquema://host[:porta]`:
 * sem caminho, sem usuário e sem senha. Exigir que a URL analisada volte
 * idêntica ao que chegou é o que impede que
 * "https://malicioso.com@dominio-proprio.com" passe por ter o host próprio.
 * Origin "null" (iframe sandbox, redirecionamento opaco) não analisa e cai
 * fora, que é o desejado.
 */
function hostDaOrigem(origem: string): string | null {
  const bruto = origem.trim();
  let url: URL;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin.toLowerCase() !== bruto.toLowerCase()) return null;
  return url.host.toLowerCase();
}

/**
 * O próprio domínio mais o que ORIGENS_PERMITIDAS acrescentar.
 *
 * O próprio vem de três fontes porque atrás do proxy da Vercel elas podem
 * divergir: a URL da requisição, o header host e o x-forwarded-host. Nenhuma
 * delas é falsificável pelo navegador de um atacante: pedir um header
 * customizado numa requisição cross-site dispara preflight, e o preflight
 * não passa.
 */
function hostsPermitidos(request: Request): string[] {
  const brutos: (string | null)[] = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    hostDaUrl(request.url),
    ...configuradas(),
  ];

  const hosts: string[] = [];
  for (const bruto of brutos) {
    const host = normalizarHost(bruto);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

function hostDaUrl(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Lista separada por vírgula. Aceita com esquema ou só o domínio. */
function configuradas(): string[] {
  return (process.env.ORIGENS_PERMITIDAS ?? "")
    .split(",")
    .map((valor) => valor.trim())
    .filter((valor) => valor.length > 0);
}

function normalizarHost(valor: string | null): string | null {
  if (!valor) return null;
  const bruto = valor.trim();
  if (!bruto) return null;
  const comEsquema = /^https?:\/\//i.test(bruto) ? bruto : `https://${bruto}`;
  try {
    const host = new URL(comEsquema).host.toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}
