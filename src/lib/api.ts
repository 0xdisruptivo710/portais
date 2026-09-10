interface CorpoErroApi {
  erro?: unknown;
}

/**
 * GET com tratamento uniforme de erro: toda resposta fora da faixa 2xx lança
 * com a mensagem que a própria API devolveu (campo "erro"), em vez de deixar
 * o corpo de erro seguir batendo como se fosse dado.
 */
export async function buscarJson<T>(url: string): Promise<T> {
  const resposta = await fetch(url);
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(mensagemDeErro(corpo, `falha ao buscar ${url}`));
  }
  return corpo as T;
}

/** Mesmo tratamento de erro do GET, para os PUT/POST que gravam algo. */
export function mensagemDeErro(corpo: unknown, padrao: string): string {
  if (corpo && typeof corpo === "object" && typeof (corpo as CorpoErroApi).erro === "string") {
    return (corpo as CorpoErroApi).erro as string;
  }
  return padrao;
}
