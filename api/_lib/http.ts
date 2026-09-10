export function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function erro(mensagem: string, status: number): Response {
  return json({ erro: mensagem }, status);
}

/** Lê um cookie do header cru. Não existe API de cookie no Request padrão. */
export function lerCookie(request: Request, nome: string): string | null {
  const bruto = request.headers.get("cookie");
  if (!bruto) return null;
  for (const parte of bruto.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}
