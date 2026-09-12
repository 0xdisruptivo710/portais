import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_lib/vendedores", () => ({ listarVendedores: vi.fn() }));

import { listarVendedores } from "./_lib/vendedores";
import { assinarSessao, COOKIE_ADMIN } from "./_lib/sessao";

const { GET } = await import("./vendedores");

const SEGREDO_SESSAO = "segredo-de-teste-bem-longo-mesmo";

function comSessao(url: string): Request {
  const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
  return new Request(url, { headers: { cookie } });
}

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SEGREDO_SESSAO;
  vi.mocked(listarVendedores).mockReset();
  vi.mocked(listarVendedores).mockResolvedValue([
    { id: 1, nome: "Murilo", wts_user_id: "78737cd4", ativo: true, ordem: 1 },
    { id: 2, nome: "Beatryz", wts_user_id: "f18f6616", ativo: true, ordem: 2 },
  ]);
});

describe("GET /api/vendedores", () => {
  it("devolve só os ativos, na ordem cadastrada", async () => {
    const r = await GET(comSessao("https://x/api/vendedores"));

    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.itens.map((v: { nome: string }) => v.nome)).toEqual(["Murilo", "Beatryz"]);
    expect(listarVendedores).toHaveBeenCalledWith("malentachi", { apenasAtivos: true });
  });

  /**
   * O painel roda no navegador do operador: o que sai daqui é o que ele pode
   * ler. O id do usuário no WTS não serve para montar o seletor e não tem
   * por que viajar junto.
   */
  it("não expõe o wts_user_id para o navegador", async () => {
    const r = await GET(comSessao("https://x/api/vendedores"));

    const corpo = await r.json();
    expect(corpo.itens[0]).toEqual({ id: 1, nome: "Murilo", ordem: 1 });
  });

  it("lista vazia é resposta, não erro", async () => {
    vi.mocked(listarVendedores).mockResolvedValue([]);

    const r = await GET(comSessao("https://x/api/vendedores"));

    expect(r.status).toBe(200);
    expect((await r.json()).itens).toEqual([]);
  });

  it("devolve 500 quando o banco falha, sem mascarar como lista vazia", async () => {
    vi.mocked(listarVendedores).mockRejectedValue(new Error("boom"));

    const r = await GET(comSessao("https://x/api/vendedores"));

    expect(r.status).toBe(500);
  });
});

describe("guarda de sessao de /api/vendedores", () => {
  it("recusa com 401 quem chama sem cookie de sessao", async () => {
    const r = await GET(new Request("https://x/api/vendedores"));
    expect(r.status).toBe(401);
    expect(listarVendedores).not.toHaveBeenCalled();
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa em vez de liberar", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    const r = await GET(comSessao("https://x/api/vendedores"));
    expect(r.status).toBe(500);
  });
});
