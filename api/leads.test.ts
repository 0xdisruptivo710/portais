import { beforeEach, describe, expect, it, vi } from "vitest";

const range = vi.fn();
const order = vi.fn(() => ({ range }));
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq, order }));
vi.mock("./_lib/supabase", () => ({ getSupabase: () => ({ from: () => ({ select }) }) }));

import { assinarSessao, COOKIE_ADMIN } from "./_lib/sessao";

const { GET: handler } = await import("./leads");

const SEGREDO_SESSAO = "segredo-de-teste-bem-longo-mesmo";

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SEGREDO_SESSAO;
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
