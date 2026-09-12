import { beforeEach, describe, expect, it, vi } from "vitest";

const range = vi.fn();
const order = vi.fn(() => ({ range }));
// `eq` devolve a si mesmo: portal e vendedor podem ser filtrados juntos, e um
// encadeamento que quebrasse no segundo .eq tem que quebrar o teste tambem.
const eq: ReturnType<typeof vi.fn> = vi.fn(() => ({ eq, order }));
const select = vi.fn(() => ({ eq, order }));
vi.mock("./_lib/supabase", () => ({ getSupabase: () => ({ from: () => ({ select }) }) }));
vi.mock("./_lib/vendedores", () => ({ listarVendedores: vi.fn() }));

import { listarVendedores } from "./_lib/vendedores";
import { assinarSessao, COOKIE_ADMIN } from "./_lib/sessao";

const { GET: handler } = await import("./leads");

const SEGREDO_SESSAO = "segredo-de-teste-bem-longo-mesmo";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SEGREDO_SESSAO;
  vi.mocked(listarVendedores).mockReset();
  vi.mocked(listarVendedores).mockResolvedValue([
    { id: 1, nome: "Murilo", wts_user_id: null, ativo: true, ordem: 1 },
    { id: 2, nome: "Beatryz", wts_user_id: null, ativo: true, ordem: 2 },
    { id: 3, nome: "Saiu", wts_user_id: null, ativo: false, ordem: 3 },
  ]);
});

/**
 * Toda rota do painel passa pela guarda de sessao: os testes de
 * comportamento mandam um cookie valido, e o teste de porta trancada (no fim
 * do arquivo) manda um Request cru, sem cookie nenhum.
 */
function comSessao(url: string, init: RequestInit = {}): Request {
  const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
  return new Request(url, {
    ...init,
    headers: { ...((init.headers ?? {}) as Record<string, string>), cookie },
  });
}


describe("GET /api/leads", () => {
  beforeEach(() => {
    range.mockReset();
    range.mockResolvedValue({ data: [], error: null });
  });

  it("responde json com a lista", async () => {
    const r = await handler(comSessao("https://x/api/leads"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
  });

  it("aceita filtro por portal", async () => {
    await handler(comSessao("https://x/api/leads?portal=webmotors"));
    expect(eq).toHaveBeenCalledWith("portal", "webmotors");
  });

  it("recusa portal fora do catálogo em vez de repassar ao banco", async () => {
    const r = await handler(comSessao("https://x/api/leads?portal=inventado"));
    expect(r.status).toBe(400);
  });

  it("devolve 500 quando o supabase falha, sem mascarar como lista vazia", async () => {
    range.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await handler(comSessao("https://x/api/leads"));
    expect(r.status).toBe(500);
  });
});

/**
 * O filtro por vendedor vai para o servidor pelo mesmo motivo do de portal:
 * filtrar em memoria sobre os 50 mais recentes esconde o lead do vendedor que
 * nao couber nessa primeira pagina. O caso de uso e' o vendedor abrir o app e
 * ver so' o que e' dele.
 */
describe("GET /api/leads: filtro por vendedor", () => {
  beforeEach(() => {
    range.mockReset();
    range.mockResolvedValue({ data: [], error: null });
    eq.mockClear();
  });

  it("aceita filtro por vendedor", async () => {
    await handler(comSessao("https://x/api/leads?vendedor=Beatryz"));
    expect(eq).toHaveBeenCalledWith("vendedor", "Beatryz");
  });

  it("portal e vendedor filtram juntos, os dois no servidor", async () => {
    await handler(comSessao("https://x/api/leads?portal=webmotors&vendedor=Murilo"));
    expect(eq).toHaveBeenCalledWith("portal", "webmotors");
    expect(eq).toHaveBeenCalledWith("vendedor", "Murilo");
  });

  // Mesma disciplina do portal: nome que nao existe devolveria lista vazia no
  // PostgREST, e lista vazia parece "esse vendedor nao tem lead nenhum".
  it("recusa vendedor que nao esta' cadastrado, em vez de repassar ao banco", async () => {
    const r = await handler(comSessao("https://x/api/leads?vendedor=Fantasma"));
    expect(r.status).toBe(400);
    expect(eq).not.toHaveBeenCalledWith("vendedor", "Fantasma");
  });

  // Vendedor desativado continua tendo os leads que ja' recebeu, e alguem
  // precisa conseguir olhar para eles.
  it("aceita vendedor desativado: os leads dele continuam existindo", async () => {
    const r = await handler(comSessao("https://x/api/leads?vendedor=Saiu"));
    expect(r.status).toBe(200);
    expect(eq).toHaveBeenCalledWith("vendedor", "Saiu");
  });

  it("devolve 500 quando a lista de vendedores nao pode ser lida", async () => {
    vi.mocked(listarVendedores).mockRejectedValue(new Error("boom"));
    const r = await handler(comSessao("https://x/api/leads?vendedor=Beatryz"));
    expect(r.status).toBe(500);
  });

  it("sem o parametro, nao gasta consulta conferindo vendedor nenhum", async () => {
    await handler(comSessao("https://x/api/leads"));
    expect(listarVendedores).not.toHaveBeenCalled();
  });
});

describe("guarda de sessao de /api/leads", () => {
  it("recusa com 401 quem chama sem cookie de sessao", async () => {
    const r = await handler(new Request("https://x/api/leads"));
    expect(r.status).toBe(401);
  });

  it("recusa com 401 cookie assinado com outro segredo", async () => {
    const forjado = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, "outro-segredo")}`;
    const r = await handler(new Request("https://x/api/leads", { headers: { cookie: forjado } }));
    expect(r.status).toBe(401);
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa em vez de liberar", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    const r = await handler(comSessao("https://x/api/leads"));
    expect(r.status).toBe(500);
  });
});
