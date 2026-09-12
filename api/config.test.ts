import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_lib/supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "./_lib/supabase";

import { assinarSessao, COOKIE_ADMIN } from "./_lib/sessao";

const { GET, PUT } = await import("./config");

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
    headers: { ...padroesDeEscrita(init.method), ...((init.headers ?? {}) as Record<string, string>), cookie },
  });
}

/**
 * O que o navegador manda sozinho numa escrita vinda do proprio painel:
 * Origin (so' em metodo que nao e' GET/HEAD) e o content-type do fetch. Sem
 * os dois, exigirOrigemConfiavel recusa - que e' a defesa de CSRF que veio
 * junto com o cookie SameSite=None.
 */
function padroesDeEscrita(metodo: string | undefined): Record<string, string> {
  if (!metodo || metodo.toUpperCase() === "GET") return {};
  return { origin: "https://x", "content-type": "application/json" };
}


const CFG_BANCO = {
  cliente_slug: "malentachi",
  texto_boas_vindas: "Oi {nome}",
  janela_supressao_dias: 30,
  horario_inicio: "08:00:00",
  horario_fim: "20:00:00",
  modo_envio: "dry_run",
  kill_switch: false,
};

interface EstadoFrom {
  cfg?: Record<string, unknown> | null;
  updateResultado?: { data: unknown; error: unknown };
}

function construirFrom(estado: EstadoFrom) {
  const chamadasUpdate: Record<string, unknown>[] = [];
  const updateResultado = estado.updateResultado ?? { data: [{ ...CFG_BANCO }], error: null };

  const from = vi.fn((tabela: string) => {
    if (tabela !== "portais_config") throw new Error(`tabela inesperada no mock: ${tabela}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: estado.cfg ?? CFG_BANCO,
            error: estado.cfg === null ? { message: "config nao encontrada" } : null,
          })),
        })),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        chamadasUpdate.push(payload);
        return { eq: vi.fn(() => ({ select: vi.fn(async () => updateResultado) })) };
      }),
    };
  });

  return { from, chamadasUpdate };
}

function mockarSupabase(estado: EstadoFrom = {}) {
  const construido = construirFrom(estado);
  vi.mocked(getSupabase).mockReturnValue({ from: construido.from } as never);
  return construido;
}

function put(corpo: unknown) {
  return PUT(
    comSessao("https://x/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
});

describe("GET /api/config", () => {
  it("devolve a config do cliente", async () => {
    mockarSupabase();
    const r = await GET(comSessao("https://x/api/config"));
    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.modo_envio).toBe("dry_run");
  });

  it("404 quando a config nao existe", async () => {
    mockarSupabase({ cfg: null });
    const r = await GET(comSessao("https://x/api/config"));
    expect(r.status).toBe(404);
  });
});

describe("PUT /api/config", () => {
  it("atualiza campos simples, como o texto de boas-vindas", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ texto_boas_vindas: "Oi {nome}, tudo bem?" });
    expect(r.status).toBe(200);
    expect(chamadasUpdate[0].texto_boas_vindas).toBe("Oi {nome}, tudo bem?");
  });

  it("aceita modo_envio dry_run", async () => {
    mockarSupabase();
    const r = await put({ modo_envio: "dry_run" });
    expect(r.status).toBe(200);
  });

  it("aceita modo_envio real", async () => {
    mockarSupabase();
    const r = await put({ modo_envio: "real" });
    expect(r.status).toBe(200);
  });

  // Esta é a guarda que impede ligar envio real por payload malformado.
  it("recusa modo_envio com valor inventado, em vez de gravar", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ modo_envio: "REAL_AGORA_JA" });
    expect(r.status).toBe(400);
    expect(chamadasUpdate).toHaveLength(0);
  });

  it("recusa modo_envio vazio", async () => {
    mockarSupabase();
    const r = await put({ modo_envio: "" });
    expect(r.status).toBe(400);
  });

  it("recusa modo_envio que nao seja string", async () => {
    mockarSupabase();
    const r = await put({ modo_envio: 1 });
    expect(r.status).toBe(400);
  });

  it("kill_switch aceita booleano puro", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ kill_switch: true });
    expect(r.status).toBe(200);
    expect(chamadasUpdate[0].kill_switch).toBe(true);
  });

  it("recusa kill_switch nao booleano", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ kill_switch: "true" });
    expect(r.status).toBe(400);
    expect(chamadasUpdate).toHaveLength(0);
  });

  // O bug que gerou este item: `from: cfg.wts_from ?? ""` no envio só cobre
  // null/undefined. Sem esta validação, um PUT gravava "" ou "   " direto no
  // banco e o remetente chegava vazio ao WTS sem nenhum aviso.
  it("recusa wts_from vazio", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ wts_from: "" });
    expect(r.status).toBe(400);
    expect(chamadasUpdate).toHaveLength(0);
  });

  it("recusa wts_from só espaço", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ wts_from: "   " });
    expect(r.status).toBe(400);
    expect(chamadasUpdate).toHaveLength(0);
  });

  it("aceita wts_from preenchido", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ wts_from: "5515991280217" });
    expect(r.status).toBe(200);
    expect(chamadasUpdate[0].wts_from).toBe("5515991280217");
  });

  // Mesmo vizinho aberto do wts_from: um texto_boas_vindas vazio monta uma
  // mensagem vazia (ver ativacao.ts). Bloquear aqui, na gravação, evita
  // que a config quebrada nem exista.
  it("recusa texto_boas_vindas vazio", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ texto_boas_vindas: "" });
    expect(r.status).toBe(400);
    expect(chamadasUpdate).toHaveLength(0);
  });

  it("recusa texto_boas_vindas só espaço", async () => {
    const { chamadasUpdate } = mockarSupabase();
    const r = await put({ texto_boas_vindas: "   " });
    expect(r.status).toBe(400);
    expect(chamadasUpdate).toHaveLength(0);
  });

  it("recusa json invalido", async () => {
    mockarSupabase();
    const r = await PUT(
      comSessao("https://x/api/config", { method: "PUT", body: "{invalido" }),
    );
    expect(r.status).toBe(400);
  });

  it("recusa corpo json valido mas nulo", async () => {
    mockarSupabase();
    const r = await put(null);
    expect(r.status).toBe(400);
  });

  it("recusa corpo sem nenhum campo reconhecido", async () => {
    mockarSupabase();
    const r = await put({ campo_que_nao_existe: 1 });
    expect(r.status).toBe(400);
  });

  it("500 quando o update nao devolve linha", async () => {
    mockarSupabase({ updateResultado: { data: [], error: null } });
    const r = await put({ texto_boas_vindas: "Oi" });
    expect(r.status).toBe(500);
  });

  // O 405 para verbo nao suportado (ex.: DELETE) nao e mais responsabilidade
  // deste modulo: so GET e PUT sao exportados, e a Vercel responde 405
  // sozinha (com Allow) quando o metodo da requisicao nao bate com nenhum
  // export nomeado do arquivo. Reimplementar aqui seria redundante.
});

describe("guarda de sessao de /api/config", () => {
  // A guarda e chamada em GET e em PUT (ver config.ts): os testes abaixo
  // cobrem os dois, ja que agora sao funcoes exportadas separadas.
  it("recusa com 401 quem chama sem cookie de sessao (GET)", async () => {
    const r = await GET(new Request("https://x/api/config"));
    expect(r.status).toBe(401);
  });

  it("recusa com 401 quem chama sem cookie de sessao (PUT)", async () => {
    const r = await PUT(new Request("https://x/api/config", { method: "PUT" }));
    expect(r.status).toBe(401);
  });

  it("recusa com 401 cookie assinado com outro segredo", async () => {
    const forjado = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, "outro-segredo")}`;
    const r = await GET(new Request("https://x/api/config", { headers: { cookie: forjado } }));
    expect(r.status).toBe(401);
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa em vez de liberar", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    const r = await GET(comSessao("https://x/api/config"));
    expect(r.status).toBe(500);
  });
});

/**
 * O cookie de sessao virou SameSite=None para sobreviver ao iframe do AIOS,
 * e com isso o navegador passou a manda-lo junto de requisicao disparada por
 * qualquer pagina da internet. A sessao sozinha nao prova mais que quem
 * pediu foi o painel: quem prova e' a conferencia de origem.
 */
describe("guarda de origem de PUT /api/config", () => {
  it("Origin do proprio app passa", async () => {
    mockarSupabase();
    const r = await put({ texto_boas_vindas: "Oi {nome}" });
    expect(r.status).toBe(200);
  });

  it("Origin desconhecida e' recusada com 403, sem tocar no banco", async () => {
    mockarSupabase();
    const r = await PUT(
      comSessao("https://x/api/config", {
        method: "PUT",
        headers: { origin: "https://site-malicioso.com" },
        body: JSON.stringify({ kill_switch: true }),
      }),
    );

    expect(r.status).toBe(403);
    expect(vi.mocked(getSupabase)).not.toHaveBeenCalled();
  });

  it("sem content-type application/json e' recusada com 415", async () => {
    mockarSupabase();
    const r = await PUT(
      comSessao("https://x/api/config", {
        method: "PUT",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "kill_switch=true",
      }),
    );

    expect(r.status).toBe(415);
    expect(vi.mocked(getSupabase)).not.toHaveBeenCalled();
  });

  it("GET nao e' afetado: passa sem Origin nenhum", async () => {
    mockarSupabase();
    const r = await GET(comSessao("https://x/api/config"));
    expect(r.status).toBe(200);
  });
});
