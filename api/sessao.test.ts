import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_ADMIN, sessaoValida } from "./_lib/sessao";

const { POST: handler } = await import("./sessao");

const CHAVE = "chave-do-embed-bem-longa";
const SEGREDO = "segredo-de-teste-bem-longo-mesmo";

function trocar(corpo: unknown, cabecalhos: Record<string, string> = {}): Promise<Response> {
  return handler(
    new Request("https://x/api/sessao", {
      method: "POST",
      // Origin e content-type sao o que o navegador manda sozinho, e o que
      // exigirOrigemConfiavel exige por causa do cookie SameSite=None.
      headers: { "content-type": "application/json", origin: "https://x", ...cabecalhos },
      body: JSON.stringify(corpo),
    }),
  );
}

/** Extrai o valor do cookie do header Set-Cookie, para valida-lo de verdade. */
function cookieDe(resposta: Response): string | null {
  const bruto = resposta.headers.get("set-cookie");
  if (!bruto) return null;
  const casado = bruto.match(new RegExp(`${COOKIE_ADMIN}=([^;]+)`));
  return casado ? casado[1] : null;
}

beforeEach(() => {
  process.env.EMBED_TOKEN = CHAVE;
  process.env.ADMIN_SESSION_SECRET = SEGREDO;
});

afterEach(() => {
  delete process.env.EMBED_TOKEN;
  delete process.env.ADMIN_SESSION_SECRET;
});

describe("POST /api/sessao", () => {
  it("com a chave certa devolve um cookie que a guarda aceita", async () => {
    const r = await trocar({ chave: CHAVE });

    expect(r.status).toBe(204);
    const cookie = cookieDe(r);
    expect(cookie).toBeTruthy();
    expect(sessaoValida(cookie, SEGREDO)).toBe(true);
  });

  it("o cookie sai SameSite=None, senao o iframe do AIOS nunca o devolve", async () => {
    const r = await trocar({ chave: CHAVE });
    expect(r.headers.get("set-cookie")).toContain("SameSite=None");
  });

  it("recusa chave errada com 401 e sem cookie", async () => {
    const r = await trocar({ chave: "chute" });

    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("recusa chave de tamanho diferente sem estourar na comparacao", async () => {
    // timingSafeEqual lanca com tamanhos diferentes; o tamanho e conferido
    // antes. Sem isso, uma chave curta derrubaria a rota com 500.
    const r = await trocar({ chave: "x" });
    expect(r.status).toBe(401);
  });

  it("recusa corpo sem chave, corpo nulo e json invalido", async () => {
    expect((await trocar({})).status).toBe(401);
    expect((await trocar(null)).status).toBe(401);

    const r = await handler(
      new Request("https://x/api/sessao", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://x" },
        body: "{invalido",
      }),
    );
    expect(r.status).toBe(401);
  });

  it("sem EMBED_TOKEN no ambiente, recusa em vez de abrir o painel para todos", async () => {
    delete process.env.EMBED_TOKEN;
    const r = await trocar({ chave: CHAVE });

    expect(r.status).toBe(500);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("com EMBED_TOKEN vazio, recusa: string vazia nao e chave", async () => {
    process.env.EMBED_TOKEN = "";
    expect((await trocar({ chave: "" })).status).toBe(500);
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa: nao ha como assinar", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    expect((await trocar({ chave: CHAVE })).status).toBe(500);
  });
});

describe("guarda de origem de POST /api/sessao", () => {
  it("Origin desconhecida e' recusada com 403 e sem cookie", async () => {
    const r = await trocar({ chave: CHAVE }, { origin: "https://site-malicioso.com" });

    expect(r.status).toBe(403);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("sem content-type application/json e' recusada com 415 e sem cookie", async () => {
    const r = await trocar({ chave: CHAVE }, { "content-type": "text/plain" });

    expect(r.status).toBe(415);
    expect(r.headers.get("set-cookie")).toBeNull();
  });
});
