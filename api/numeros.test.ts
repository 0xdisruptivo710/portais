import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_lib/supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "./_lib/supabase";

const { default: handler } = await import("./numeros");

interface EstadoFrom {
  leads?: { portal: string; metodo: string }[];
  erroLeads?: { message: string } | null;
  eventosRevisao?: { portal: string }[];
  erroEventos?: { message: string } | null;
}

function construirFrom(estado: EstadoFrom) {
  const from = vi.fn((tabela: string) => {
    if (tabela === "portais_leads") {
      return {
        select: vi.fn(async () => ({ data: estado.leads ?? [], error: estado.erroLeads ?? null })),
      };
    }
    if (tabela === "portais_eventos_raw") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: estado.eventosRevisao ?? [], error: estado.erroEventos ?? null })),
        })),
      };
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });
  return { from };
}

function mockarSupabase(estado: EstadoFrom = {}) {
  const construido = construirFrom(estado);
  vi.mocked(getSupabase).mockReturnValue({ from: construido.from } as never);
  return construido;
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
});

describe("GET /api/numeros", () => {
  it("devolve total, taxa de identificacao automatica e revisao por portal", async () => {
    mockarSupabase({
      leads: [
        { portal: "webmotors", metodo: "parser" },
        { portal: "webmotors", metodo: "ia" },
        { portal: "icarros", metodo: "parser" },
      ],
      eventosRevisao: [{ portal: "webmotors" }],
    });

    const r = await handler(new Request("https://x/api/numeros"));
    expect(r.status).toBe(200);
    const corpo = await r.json();

    const webmotors = corpo.itens.find((i: { portal: string }) => i.portal === "webmotors");
    expect(webmotors.total).toBe(2);
    expect(webmotors.taxa_identificacao).toBe(0.5);
    expect(webmotors.revisao).toBe(1);

    const icarros = corpo.itens.find((i: { portal: string }) => i.portal === "icarros");
    expect(icarros.total).toBe(1);
    expect(icarros.taxa_identificacao).toBe(1);
    expect(icarros.revisao).toBe(0);
  });

  it("portal sem nenhum lead nao quebra a taxa (divisao por zero)", async () => {
    mockarSupabase({ leads: [], eventosRevisao: [] });

    const r = await handler(new Request("https://x/api/numeros"));
    const corpo = await r.json();

    const olx = corpo.itens.find((i: { portal: string }) => i.portal === "olx");
    expect(olx.total).toBe(0);
    expect(olx.taxa_identificacao).toBe(0);
  });

  it("devolve 500 quando o supabase falha, sem mascarar como lista vazia", async () => {
    mockarSupabase({ erroLeads: { message: "boom" } });

    const r = await handler(new Request("https://x/api/numeros"));
    expect(r.status).toBe(500);
  });
});
