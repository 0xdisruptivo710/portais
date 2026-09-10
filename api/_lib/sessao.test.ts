import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assinarSessao, cabecalhoSessao, COOKIE_ADMIN, exigirAdmin, exigirCron, sessaoValida } from "./sessao";

const SEGREDO = "segredo-de-teste-bem-longo-mesmo";
const SEGREDO_CRON = "segredo-do-cron-bem-longo";

function comCookie(cookie: string): Request {
  return new Request("https://x/api/config", { headers: { cookie: `${COOKIE_ADMIN}=${cookie}` } });
}

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SEGREDO;
  process.env.CRON_SECRET = SEGREDO_CRON;
});

afterEach(() => {
  delete process.env.ADMIN_SESSION_SECRET;
  delete process.env.CRON_SECRET;
});

describe("sessao do painel", () => {
  it("aceita cookie que ela mesma assinou e ainda nao expirou", () => {
    expect(sessaoValida(assinarSessao(Date.now() + 60_000, SEGREDO), SEGREDO)).toBe(true);
  });

  it("recusa cookie expirado", () => {
    expect(sessaoValida(assinarSessao(Date.now() - 1, SEGREDO), SEGREDO)).toBe(false);
  });

  it("recusa cookie com assinatura adulterada", () => {
    const [payload] = assinarSessao(Date.now() + 60_000, SEGREDO).split(".");
    expect(sessaoValida(`${payload}.${"0".repeat(64)}`, SEGREDO)).toBe(false);
  });

  it("recusa cookie assinado com outro segredo", () => {
    expect(sessaoValida(assinarSessao(Date.now() + 60_000, "outro-segredo-qualquer"), SEGREDO)).toBe(false);
  });

  it("recusa quem tenta esticar a validade mexendo no payload", () => {
    const [, assinatura] = assinarSessao(Date.now() + 60_000, SEGREDO).split(".");
    expect(sessaoValida(`${Date.now() + 999_999}.${assinatura}`, SEGREDO)).toBe(false);
  });

  it("recusa cookie ausente ou malformado", () => {
    expect(sessaoValida(null, SEGREDO)).toBe(false);
    expect(sessaoValida("", SEGREDO)).toBe(false);
    expect(sessaoValida("sem-ponto", SEGREDO)).toBe(false);
    expect(sessaoValida("a.b", SEGREDO)).toBe(false);
  });

  it("o cookie que a funcao emite e' HttpOnly, Secure e SameSite", () => {
    const cabecalho = cabecalhoSessao(SEGREDO);
    expect(cabecalho).toContain("HttpOnly");
    expect(cabecalho).toContain("Secure");
    expect(cabecalho).toContain("SameSite=Strict");
  });
});

describe("exigirAdmin", () => {
  it("deixa passar quem tem cookie valido", () => {
    expect(exigirAdmin(comCookie(assinarSessao(Date.now() + 60_000, SEGREDO)))).toBeNull();
  });

  it("recusa com 401 quem nao manda cookie nenhum", async () => {
    const r = exigirAdmin(new Request("https://x/api/config"));
    expect(r?.status).toBe(401);
  });

  it("recusa com 401 cookie assinado com outro segredo", () => {
    expect(exigirAdmin(comCookie(assinarSessao(Date.now() + 60_000, "outro")))?.status).toBe(401);
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa em vez de liberar", () => {
    // Fail-closed: variavel de segredo ausente e' erro de configuracao, e
    // erro de configuracao nunca pode abrir a porta.
    delete process.env.ADMIN_SESSION_SECRET;
    expect(exigirAdmin(comCookie(assinarSessao(Date.now() + 60_000, SEGREDO)))?.status).toBe(500);
  });

  it("recusa com 401 (nao 500) cookie com percent-encoding invalido", () => {
    // lerCookie fazia decodeURIComponent sem tratamento: "%" sozinho lanca
    // URIError e derrubava a guarda com 500 antes mesmo de checar a sessao.
    // Cookie ilegivel tem que valer como cookie ausente.
    const r = exigirAdmin(comCookie("%"));
    expect(r?.status).toBe(401);
  });
});

describe("exigirCron", () => {
  function comAutorizacao(valor: string): Request {
    return new Request("https://x/api/cron/varrer", { headers: { authorization: valor } });
  }

  it("deixa passar com o segredo certo no Authorization", () => {
    expect(exigirCron(comAutorizacao(`Bearer ${SEGREDO_CRON}`))).toBeNull();
  });

  it("recusa segredo errado", () => {
    expect(exigirCron(comAutorizacao("Bearer segredo-errado"))?.status).toBe(401);
  });

  it("recusa quem nao manda Authorization nenhum", () => {
    expect(exigirCron(new Request("https://x/api/cron/varrer"))?.status).toBe(401);
  });

  it("recusa cookie de admin no lugar do segredo: sao portas diferentes", () => {
    expect(exigirCron(comCookie(assinarSessao(Date.now() + 60_000, SEGREDO)))?.status).toBe(401);
  });

  it("sem CRON_SECRET no ambiente, recusa em vez de liberar", () => {
    delete process.env.CRON_SECRET;
    expect(exigirCron(comAutorizacao(`Bearer ${SEGREDO_CRON}`))?.status).toBe(500);
  });
});
