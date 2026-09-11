import { timingSafeEqual } from "node:crypto";
import { erro } from "./_lib/http.js";
import { cabecalhoSessao } from "./_lib/sessao.js";

/**
 * POST /api/login: troca a senha da operação pelo cookie de sessão que as
 * rotas do painel exigem. Senha única por instalação, guardada em
 * ADMIN_SENHA — o painel é interno, não tem usuários.
 *
 * Toda recusa devolve a mesma resposta 401, sem distinguir "corpo
 * malformado" de "senha errada": diferenciar só ajudaria quem está tentando
 * adivinhar.
 */
export async function POST(request: Request): Promise<Response> {
  const senhaEsperada = process.env.ADMIN_SENHA;
  const segredo = process.env.ADMIN_SESSION_SECRET;
  if (!senhaEsperada || !segredo) return erro("painel nao configurado", 500);

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return erro("nao autorizado", 401);
  }
  if (typeof corpo !== "object" || corpo === null) return erro("nao autorizado", 401);

  const senha = (corpo as Record<string, unknown>).senha;
  if (typeof senha !== "string" || !iguais(senha, senhaEsperada)) {
    return erro("nao autorizado", 401);
  }

  return new Response(null, {
    status: 204,
    headers: { "set-cookie": cabecalhoSessao(segredo) },
  });
}

/** Comparação em tempo constante, mesma regra de _lib/sessao.ts. */
function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
