import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_lib/supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "./_lib/supabase";

const { default: handler } = await import("./revisao");

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
});

describe("GET /api/revisao", () => {
  it("lista os eventos com status revisao", async () => {
    mockarSupabase({ eventosRevisao: [{ id: 9, portal: "webmotors" }] });

    const r = await handler(new Request("https://x/api/revisao"));

    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.itens).toHaveLength(1);
  });

  it("devolve 500 quando o supabase falha, sem mascarar como lista vazia", async () => {
    mockarSupabase({ erroListaEventos: { message: "boom" } });

    const r = await handler(new Request("https://x/api/revisao"));

    expect(r.status).toBe(500);
  });
});

describe("POST /api/revisao", () => {
  function postar(corpo: unknown) {
    return handler(
      new Request("https://x/api/revisao", {
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
    const r = await handler(
      new Request("https://x/api/revisao", { method: "POST", body: "{invalido" }),
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

  it("500 quando o upsert do lead não devolve linha", async () => {
    mockarSupabase({
      evento: { id: 9, portal: "webmotors" },
      upsertLeadResultado: { data: [], error: null },
    });

    const r = await postar({ evento_id: 9, nome: "Fulano" });

    expect(r.status).toBe(500);
  });
});
