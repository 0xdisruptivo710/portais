import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COOKIE_ADMIN, sessaoValida } from "./_lib/sessao";

const { default: handler } = await import("./login");

const SENHA = "senha-da-operacao";
const SEGREDO = "segredo-de-teste-bem-longo-mesmo";

function entrar(corpo: unknown, metodo = "POST"): Promise<Response> {
  return handler(
    new Request("https://x/api/login", {
      method: metodo,
      headers: { "content-type": "application/json" },
      body: metodo === "POST" ? JSON.stringify(corpo) : undefined,
    }),
  );
}

/** Extrai o valor do cookie do header Set-Cookie, para validá-lo de verdade. */
function cookieDe(resposta: Response): string | null {
  const bruto = resposta.headers.get("set-cookie");
  if (!bruto) return null;
  const casado = bruto.match(new RegExp(`${COOKIE_ADMIN}=([^;]+)`));
  return casado ? casado[1] : null;
}

beforeEach(() => {
  process.env.ADMIN_SENHA = SENHA;
  process.env.ADMIN_SESSION_SECRET = SEGREDO;
});

afterEach(() => {
  delete process.env.ADMIN_SENHA;
  delete process.env.ADMIN_SESSION_SECRET;
});

describe("POST /api/login", () => {
  it("com a senha certa devolve um cookie que a guarda aceita", async () => {
    const r = await entrar({ senha: SENHA });

    expect(r.status).toBe(204);
    const cookie = cookieDe(r);
    expect(cookie).toBeTruthy();
    expect(sessaoValida(cookie, SEGREDO)).toBe(true);
  });

  it("recusa senha errada com 401 e sem cookie", async () => {
    const r = await entrar({ senha: "chute" });

    expect(r.status).toBe(401);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("recusa corpo sem senha, corpo nulo e json invalido", async () => {
    expect((await entrar({})).status).toBe(401);
    expect((await entrar(null)).status).toBe(401);

    const r = await handler(new Request("https://x/api/login", { method: "POST", body: "{invalido" }));
    expect(r.status).toBe(401);
  });

  it("sem ADMIN_SENHA no ambiente, recusa em vez de deixar entrar sem senha", async () => {
    delete process.env.ADMIN_SENHA;
    const r = await entrar({ senha: SENHA });
    expect(r.status).toBe(500);
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa: nao ha como assinar", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    expect((await entrar({ senha: SENHA })).status).toBe(500);
  });

  it("so aceita POST", async () => {
    expect((await entrar(null, "GET")).status).toBe(405);
  });
});
