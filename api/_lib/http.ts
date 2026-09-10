export function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function erro(mensagem: string, status: number): Response {
  return json({ erro: mensagem }, status);
}

/**
 * Lê um cookie do header cru. Não existe API de cookie no Request padrão.
 *
 * A guarda de sessão roda isto antes de qualquer outra coisa nos endpoints do
 * painel, então um percent-encoding inválido (ex.: "%" sozinho) não pode
 * lançar: decodeURIComponent estoura URIError, e sem o try/catch qualquer
 * requisição anônima com esse cookie derrubaria os 4 endpoints com 500 em vez
 * do 401 esperado. Cookie ilegível vale o mesmo que cookie ausente: null.
 */
export function lerCookie(request: Request, nome: string): string | null {
  const bruto = request.headers.get("cookie");
  if (!bruto) return null;
  for (const parte of bruto.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) {
      try {
        return decodeURIComponent(resto.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}
