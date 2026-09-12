import { afterEach, describe, expect, it } from "vitest";
import { exigirOrigemConfiavel } from "./origem";

const PROPRIO = "https://portais.exemplo.com";

/** Requisicao de escrita como o navegador do painel monta: JSON e Origin proprio. */
function escrever(cabecalhos: Record<string, string | null> = {}): Request {
  const base: Record<string, string> = {
    "content-type": "application/json",
    origin: PROPRIO,
  };
  for (const [chave, valor] of Object.entries(cabecalhos)) {
    if (valor === null) delete base[chave];
    else base[chave] = valor;
  }
  return new Request(`${PROPRIO}/api/enviar`, { method: "POST", headers: base, body: "{}" });
}

afterEach(() => {
  delete process.env.ORIGENS_PERMITIDAS;
});

describe("origem propria", () => {
  it("deixa passar a requisicao que veio do proprio dominio", () => {
    expect(exigirOrigemConfiavel(escrever())).toBeNull();
  });

  it("deixa passar mesmo sem ORIGENS_PERMITIDAS configurada", () => {
    // Fail-closed que nao derruba nada: a origem propria sai da URL da
    // requisicao, nao da variavel. A variavel so acrescenta dominios.
    delete process.env.ORIGENS_PERMITIDAS;
    expect(exigirOrigemConfiavel(escrever())).toBeNull();
  });

  it("recusa com 403 uma origem desconhecida", () => {
    expect(exigirOrigemConfiavel(escrever({ origin: "https://site-malicioso.com" }))?.status).toBe(403);
  });

  it("recusa com 403 quem nao manda Origin nenhum", () => {
    expect(exigirOrigemConfiavel(escrever({ origin: null }))?.status).toBe(403);
  });

  it("recusa Origin 'null', que e' o que iframe sandbox e redirecionamento opaco mandam", () => {
    expect(exigirOrigemConfiavel(escrever({ origin: "null" }))?.status).toBe(403);
  });

  it("recusa Origin com usuario embutido apontando pro dominio proprio", () => {
    // "https://malicioso.com@portais.exemplo.com" tem host proprio para quem
    // le so' o host. Navegador nenhum manda Origin assim.
    const r = exigirOrigemConfiavel(escrever({ origin: `https://malicioso.com@portais.exemplo.com` }));
    expect(r?.status).toBe(403);
  });
});

describe("ORIGENS_PERMITIDAS", () => {
  it("aceita dominio da lista, para o AIOS entrar quando o embed existir", () => {
    process.env.ORIGENS_PERMITIDAS = "https://app.aios.com.br";
    expect(exigirOrigemConfiavel(escrever({ origin: "https://app.aios.com.br" }))).toBeNull();
  });

  it("aceita lista separada por virgula, com espaco sobrando", () => {
    process.env.ORIGENS_PERMITIDAS = " https://app.aios.com.br , https://outro.aios.com.br ";
    expect(exigirOrigemConfiavel(escrever({ origin: "https://outro.aios.com.br" }))).toBeNull();
  });

  it("dominio de fora da lista continua recusado", () => {
    process.env.ORIGENS_PERMITIDAS = "https://app.aios.com.br";
    expect(exigirOrigemConfiavel(escrever({ origin: "https://app.aios.com.br.evil.com" }))?.status).toBe(403);
  });
});

describe("content-type", () => {
  it("recusa formulario HTML, que e' o que um site de terceiro consegue postar sem preflight", () => {
    const r = exigirOrigemConfiavel(escrever({ "content-type": "application/x-www-form-urlencoded" }));
    expect(r?.status).toBe(415);
  });

  it("recusa text/plain e multipart, os outros dois que o formulario alcanca", () => {
    expect(exigirOrigemConfiavel(escrever({ "content-type": "text/plain" }))?.status).toBe(415);
    expect(exigirOrigemConfiavel(escrever({ "content-type": "multipart/form-data" }))?.status).toBe(415);
  });

  it("recusa requisicao sem content-type nenhum", () => {
    expect(exigirOrigemConfiavel(escrever({ "content-type": null }))?.status).toBe(415);
  });

  it("aceita application/json com charset junto", () => {
    expect(exigirOrigemConfiavel(escrever({ "content-type": "application/json; charset=utf-8" }))).toBeNull();
  });
});
