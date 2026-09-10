import { describe, expect, it } from "vitest";
import { erro, json, lerCookie } from "./http";

function comCookie(cookie: string): Request {
  return new Request("https://x/api/config", { headers: { cookie } });
}

describe("lerCookie", () => {
  it("lê o valor de um cookie simples entre outros", () => {
    expect(lerCookie(comCookie("a=1; portais_admin=abc.def; b=2"), "portais_admin")).toBe("abc.def");
  });

  it("devolve null quando o cookie nao existe", () => {
    expect(lerCookie(comCookie("a=1"), "portais_admin")).toBeNull();
  });

  it("devolve null quando nao ha header cookie nenhum", () => {
    expect(lerCookie(new Request("https://x/api/config"), "portais_admin")).toBeNull();
  });

  // decodeURIComponent("%") lanca URIError: URI malformed. Sem tratamento,
  // qualquer requisicao anonima com esse cookie derruba os 4 endpoints do
  // painel com 500 em vez do 401 esperado — a guarda de sessao roda lerCookie
  // antes de qualquer outra coisa.
  it("cookie com percent-encoding invalido: devolve null em vez de lancar", () => {
    expect(() => lerCookie(comCookie("portais_admin=%"), "portais_admin")).not.toThrow();
    expect(lerCookie(comCookie("portais_admin=%"), "portais_admin")).toBeNull();
  });
});

describe("json/erro", () => {
  it("json monta Response com content-type e status", async () => {
    const r = json({ ok: true }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await r.json()).toEqual({ ok: true });
  });

  it("erro monta o mesmo formato com a chave 'erro'", async () => {
    const r = erro("nao autorizado", 401);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ erro: "nao autorizado" });
  });
});
