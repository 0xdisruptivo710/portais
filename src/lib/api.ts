interface CorpoErroApi {
  erro?: unknown;
}

type OuvinteSessao = () => void;

const ouvintes = new Set<OuvinteSessao>();

/**
 * Erro de sessão perdida. Existe como tipo próprio para não se confundir com
 * erro de conteúdo: quando ele é lançado, a tela que pediu o dado já está
 * sendo desmontada pelo App, e a mensagem só apareceria num piscar. Por isso
 * ela é escrita como frase de operador, e não como código de API.
 */
export class SessaoExpirada extends Error {
  constructor() {
    super("Sua sessão expirou.");
    this.name = "SessaoExpirada";
  }
}

/**
 * Assinatura para saber que a sessão caiu. Quem escuta é o App, que troca o
 * painel inteiro pelo login. Devolve a função de cancelar, para o efeito do
 * React limpar a inscrição quando desmonta.
 */
export function aoPerderSessao(ouvinte: OuvinteSessao): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

/**
 * Toda chamada do painel passa por aqui. O motivo é um só: 401 não é erro de
 * conteúdo, é fim de sessão, e tratar isso tela por tela significa que a
 * próxima tela vai esquecer. O cookie dura 12h; quando ele expira com a aba
 * aberta, cada tela passava a exibir "nao autorizado" dentro do painel, sem
 * dizer ao operador que o que ele precisa é entrar de novo.
 *
 * A cópia da lista antes de avisar evita que um ouvinte que se cancela
 * durante o aviso mexa no conjunto que está sendo percorrido.
 */
export async function chamarApi(url: string, init?: RequestInit): Promise<Response> {
  // fetch(url) e fetch(url, undefined) não são a mesma chamada para quem
  // observa o mock nos testes; sem init, chama com um argumento só.
  const resposta = init ? await fetch(url, init) : await fetch(url);
  if (resposta.status === 401) {
    for (const ouvinte of [...ouvintes]) ouvinte();
    throw new SessaoExpirada();
  }
  return resposta;
}

/**
 * GET com tratamento uniforme de erro: toda resposta fora da faixa 2xx lança
 * com a mensagem que a própria API devolveu (campo "erro"), em vez de deixar
 * o corpo de erro seguir batendo como se fosse dado. O 401 nem chega aqui:
 * chamarApi já o transformou em queda de sessão.
 */
export async function buscarJson<T>(url: string): Promise<T> {
  const resposta = await chamarApi(url);
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(mensagemDeErro(corpo, `falha ao buscar ${url}`));
  }
  return corpo as T;
}

/**
 * Checagem de entrada do App, e o único lugar que fala com a API sem passar
 * por chamarApi. É de propósito: aqui o 401 é o primeiro acesso, o caminho
 * normal para mostrar o login, e não uma sessão que caiu. Se ela avisasse os
 * ouvintes, a entrada no painel viraria um laço de "sessão expirada" para
 * quem nunca entrou.
 *
 * Falha de rede vale como sem sessão: a guarda que decide de verdade é a do
 * servidor, e o pior que acontece aqui é pedir a senha de novo.
 */
export async function temSessao(): Promise<boolean> {
  try {
    const resposta = await fetch("/api/config");
    return resposta.status !== 401;
  } catch {
    return false;
  }
}

/** Mesmo tratamento de erro do GET, para os PUT/POST que gravam algo. */
export function mensagemDeErro(corpo: unknown, padrao: string): string {
  if (corpo && typeof corpo === "object" && typeof (corpo as CorpoErroApi).erro === "string") {
    return (corpo as CorpoErroApi).erro as string;
  }
  return padrao;
}
