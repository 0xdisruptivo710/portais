export function json(dados: unknown, status = 200): Response {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function erro(mensagem: string, status: number): Response {
  return json({ erro: mensagem }, status);
}
