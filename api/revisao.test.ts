import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_lib/supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("./_lib/vendedores", () => ({ definirVendedor: vi.fn() }));
import { getSupabase } from "./_lib/supabase";
import { definirVendedor } from "./_lib/vendedores";

import { assinarSessao, COOKIE_ADMIN } from "./_lib/sessao";

const { GET, POST } = await import("./revisao");

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


interface EstadoFrom {
  eventosRevisao?: Record<string, unknown>[];
  erroListaEventos?: { message: string } | null;
  evento?: Record<string, unknown> | null;
  upsertLeadResultado?: { data: unknown; error: unknown };
  updateEventoResultado?: { data: unknown; error: unknown };
}

/**
 * Reconstrói, chamada por chamada, os encadeamentos reais que o handler faz
 * no Supabase — mesmo padrão de processar.test.ts — para que um erro de
 * encadeamento no código de produção quebre o teste em vez de passar calado.
 */
function construirFrom(estado: EstadoFrom) {
  const chamadasUpsertLead: { payload: Record<string, unknown>; opts: unknown }[] = [];
  const chamadasUpdateEvento: Record<string, unknown>[] = [];

  const upsertLeadResultado = estado.upsertLeadResultado ?? { data: [{ id: 42 }], error: null };
  const updateEventoResultado = estado.updateEventoResultado ?? { data: [{ id: 1 }], error: null };

  const from = vi.fn((tabela: string) => {
    if (tabela === "portais_eventos_raw") {
      return {
        select: vi.fn((cols: string) => {
          if (cols === "id,portal") {
            return {
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: estado.evento ?? null,
                  error: estado.evento ? null : { message: "evento nao encontrado" },
                })),
              })),
            };
          }
          // listagem da fila de revisão
          return {
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({
                data: estado.eventosRevisao ?? [],
                error: estado.erroListaEventos ?? null,
              })),
            })),
          };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          chamadasUpdateEvento.push(payload);
          return { eq: vi.fn(() => ({ select: vi.fn(async () => updateEventoResultado) })) };
        }),
      };
    }
    if (tabela === "portais_leads") {
      return {
        upsert: vi.fn((payload: Record<string, unknown>, opts: unknown) => {
          chamadasUpsertLead.push({ payload, opts });
          return { select: vi.fn(async () => upsertLeadResultado) };
        }),
      };
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });

  return { from, chamadasUpsertLead, chamadasUpdateEvento };
}

function mockarSupabase(estado: EstadoFrom = {}) {
  const construido = construirFrom(estado);
  vi.mocked(getSupabase).mockReturnValue({ from: construido.from } as never);
  return construido;
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
  vi.mocked(definirVendedor).mockReset();
  vi.mocked(definirVendedor).mockResolvedValue(null);
});

describe("GET /api/revisao", () => {
  it("lista os eventos com status revisao", async () => {
    mockarSupabase({ eventosRevisao: [{ id: 9, portal: "webmotors" }] });

    const r = await GET(comSessao("https://x/api/revisao"));

    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.itens).toHaveLength(1);
  });

  it("devolve 500 quando o supabase falha, sem mascarar como lista vazia", async () => {
    mockarSupabase({ erroListaEventos: { message: "boom" } });

    const r = await GET(comSessao("https://x/api/revisao"));

    expect(r.status).toBe(500);
  });
});

describe("POST /api/revisao", () => {
  function postar(corpo: unknown) {
    return POST(
      comSessao("https://x/api/revisao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
      }),
    );
  }

  it("recusa corpo sem evento_id", async () => {
    mockarSupabase();
    const r = await postar({ nome: "Fulano" });
    expect(r.status).toBe(400);
  });

  it("recusa json invalido", async () => {
    mockarSupabase();
    const r = await POST(
      comSessao("https://x/api/revisao", { method: "POST", body: "{invalido" }),
    );
    expect(r.status).toBe(400);
  });

  it("404 quando o evento não existe", async () => {
    mockarSupabase({ evento: null });
    const r = await postar({ evento_id: 999, nome: "Fulano" });
    expect(r.status).toBe(404);
  });

  it("completa a revisão: grava o lead com metodo manual e marca o evento como parseado", async () => {
    const { chamadasUpsertLead, chamadasUpdateEvento } = mockarSupabase({
      evento: { id: 9, portal: "webmotors" },
    });

    const r = await postar({
      evento_id: 9,
      nome: "Fulano da Silva",
      telefone: "15991280217",
      veiculo_texto: "Civic 2020",
    });

    expect(r.status).toBe(201);
    expect(chamadasUpsertLead).toHaveLength(1);
    expect(chamadasUpsertLead[0].payload.metodo).toBe("manual");
    expect(chamadasUpsertLead[0].payload.confianca).toBe("alta");
    expect(chamadasUpsertLead[0].payload.evento_id).toBe(9);
    expect(chamadasUpsertLead[0].payload.telefone_e164).toBe("5515991280217");
    expect(chamadasUpdateEvento.some((c) => c.status === "parseado")).toBe(true);
  });

  // Lead completado na revisão é lead como qualquer outro: sai da fila com
  // dono, pelas mesmas duas regras da varredura automática.
  it("o lead completado sai com vendedor, pela mesma distribuição da varredura", async () => {
    const { chamadasUpsertLead } = mockarSupabase({ evento: { id: 9, portal: "webmotors" } });
    vi.mocked(definirVendedor).mockResolvedValue("Beatryz");

    await postar({ evento_id: 9, nome: "Fulano", telefone: "15991280217" });

    expect(definirVendedor).toHaveBeenCalledWith({
      clienteSlug: "malentachi",
      telefoneE164: "5515991280217",
      eventoId: 9,
    });
    expect(chamadasUpsertLead[0].payload.vendedor).toBe("Beatryz");
  });

  it("sem vendedor ativo a revisão é completada assim mesmo, com vendedor nulo", async () => {
    const { chamadasUpsertLead } = mockarSupabase({ evento: { id: 9, portal: "webmotors" } });

    const r = await postar({ evento_id: 9, nome: "Fulano", telefone: "15991280217" });

    expect(r.status).toBe(201);
    expect(chamadasUpsertLead[0].payload.vendedor).toBeNull();
  });

  it("500 quando o upsert do lead não devolve linha", async () => {
    mockarSupabase({
      evento: { id: 9, portal: "webmotors" },
      upsertLeadResultado: { data: [], error: null },
    });

    const r = await postar({ evento_id: 9, nome: "Fulano" });

    expect(r.status).toBe(500);
  });
});

describe("guarda de sessao de /api/revisao", () => {
  // A guarda é chamada em GET e em POST (ver revisao.ts): os testes abaixo
  // cobrem os dois, já que agora são funções exportadas separadas.
  it("recusa com 401 quem chama sem cookie de sessao (GET)", async () => {
    const r = await GET(new Request("https://x/api/revisao"));
    expect(r.status).toBe(401);
  });

  it("recusa com 401 quem chama sem cookie de sessao (POST)", async () => {
    const r = await POST(new Request("https://x/api/revisao", { method: "POST" }));
    expect(r.status).toBe(401);
  });

  it("recusa com 401 cookie assinado com outro segredo", async () => {
    const forjado = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, "outro-segredo")}`;
    const r = await GET(new Request("https://x/api/revisao", { headers: { cookie: forjado } }));
    expect(r.status).toBe(401);
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa em vez de liberar", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    const r = await GET(comSessao("https://x/api/revisao"));
    expect(r.status).toBe(500);
  });
});

/**
 * O cookie de sessao virou SameSite=None para sobreviver ao iframe do AIOS,
 * e com isso o navegador passou a manda-lo junto de requisicao disparada por
 * qualquer pagina da internet. A sessao sozinha nao prova mais que quem
 * pediu foi o painel: quem prova e' a conferencia de origem.
 */
describe("guarda de origem de POST /api/revisao", () => {
  it("Origin desconhecida e' recusada com 403, sem tocar no banco", async () => {
    mockarSupabase();
    const r = await POST(
      comSessao("https://x/api/revisao", {
        method: "POST",
        headers: { origin: "https://site-malicioso.com" },
        body: JSON.stringify({ evento_id: 1, nome: "Fulano" }),
      }),
    );

    expect(r.status).toBe(403);
    expect(vi.mocked(getSupabase)).not.toHaveBeenCalled();
  });

  it("sem content-type application/json e' recusada com 415", async () => {
    mockarSupabase();
    const r = await POST(
      comSessao("https://x/api/revisao", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ evento_id: 1 }),
      }),
    );

    expect(r.status).toBe(415);
    expect(vi.mocked(getSupabase)).not.toHaveBeenCalled();
  });

  it("GET nao e' afetado: passa sem Origin nenhum", async () => {
    mockarSupabase();
    const r = await GET(comSessao("https://x/api/revisao"));
    expect(r.status).toBe(200);
  });
});
