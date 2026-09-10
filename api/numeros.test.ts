import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_lib/supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "./_lib/supabase";

import { assinarSessao, COOKIE_ADMIN } from "./_lib/sessao";

const { default: handler } = await import("./numeros");

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
    headers: { ...((init.headers ?? {}) as Record<string, string>), cookie },
  });
}


interface LeadFixture {
  portal: string;
  metodo: string;
  capturado_em: string;
  enviado_em: string | null;
}

interface EstadoFrom {
  leads?: LeadFixture[];
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

function lead(overrides: Partial<LeadFixture>): LeadFixture {
  return { portal: "webmotors", metodo: "parser", capturado_em: "2026-09-10T12:00:00.000Z", enviado_em: null, ...overrides };
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
  // "Agora" fixo em 2026-09-10 12h em São Paulo, pra série diária e filtro
  // de `dias` terem uma referência estável entre os testes.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T15:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/numeros", () => {
  it("devolve total, taxa de identificacao automatica e revisao por portal", async () => {
    mockarSupabase({
      leads: [
        lead({ portal: "webmotors", metodo: "parser" }),
        lead({ portal: "webmotors", metodo: "ia" }),
        lead({ portal: "icarros", metodo: "parser" }),
      ],
      eventosRevisao: [{ portal: "webmotors" }],
    });

    const r = await handler(comSessao("https://x/api/numeros"));
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

  it("portal sem nenhum lead nao quebra a taxa nem o tempo de contato (divisao por zero / NaN)", async () => {
    mockarSupabase({ leads: [], eventosRevisao: [] });

    const r = await handler(comSessao("https://x/api/numeros"));
    const corpo = await r.json();

    const olx = corpo.itens.find((i: { portal: string }) => i.portal === "olx");
    expect(olx.total).toBe(0);
    expect(olx.taxa_identificacao).toBe(0);
    expect(olx.tempo_mediano_primeiro_contato_min).toBeNull();
    expect(corpo.serie_diaria).toEqual([]);
  });

  it("devolve 500 quando o supabase falha, sem mascarar como lista vazia", async () => {
    mockarSupabase({ erroLeads: { message: "boom" } });

    const r = await handler(comSessao("https://x/api/numeros"));
    expect(r.status).toBe(500);
  });

  describe("tempo mediano até o primeiro contato", () => {
    it("calcula a mediana só sobre leads com enviado_em, ignorando os ainda não contatados", async () => {
      mockarSupabase({
        leads: [
          // 30min e 10min contatados: mediana = 20min (par -> média dos 2 do meio).
          lead({ portal: "webmotors", capturado_em: "2026-09-01T09:00:00.000Z", enviado_em: "2026-09-01T09:30:00.000Z" }),
          lead({ portal: "webmotors", capturado_em: "2026-09-01T10:00:00.000Z", enviado_em: "2026-09-01T10:10:00.000Z" }),
          // Ainda não contatado: não pode entrar no cálculo nem gerar NaN.
          lead({ portal: "webmotors", capturado_em: "2026-09-01T11:00:00.000Z", enviado_em: null }),
        ],
      });

      const r = await handler(comSessao("https://x/api/numeros"));
      const corpo = await r.json();

      const webmotors = corpo.itens.find((i: { portal: string }) => i.portal === "webmotors");
      expect(webmotors.tempo_mediano_primeiro_contato_min).toBe(20);
    });

    it("mediana com número ímpar de leads contatados pega o valor do meio", async () => {
      mockarSupabase({
        leads: [
          lead({ portal: "icarros", capturado_em: "2026-09-01T09:00:00.000Z", enviado_em: "2026-09-01T09:05:00.000Z" }), // 5
          lead({ portal: "icarros", capturado_em: "2026-09-01T09:00:00.000Z", enviado_em: "2026-09-01T09:15:00.000Z" }), // 15
          lead({ portal: "icarros", capturado_em: "2026-09-01T09:00:00.000Z", enviado_em: "2026-09-01T10:00:00.000Z" }), // 60
        ],
      });

      const r = await handler(comSessao("https://x/api/numeros"));
      const corpo = await r.json();

      const icarros = corpo.itens.find((i: { portal: string }) => i.portal === "icarros");
      expect(icarros.tempo_mediano_primeiro_contato_min).toBe(15);
    });
  });

  describe("série diária de leads por portal", () => {
    it("agrupa por dia (fuso de São Paulo) e portal, ignorando leads fora da janela de `dias`", async () => {
      mockarSupabase({
        leads: [
          // Dentro da janela padrão (30 dias antes de 2026-09-10).
          lead({ portal: "webmotors", capturado_em: "2026-09-09T15:00:00.000Z" }),
          lead({ portal: "webmotors", capturado_em: "2026-09-09T16:00:00.000Z" }),
          lead({ portal: "icarros", capturado_em: "2026-09-09T15:00:00.000Z" }),
          // Fora da janela padrão de 30 dias (mais de 30 dias atrás): não
          // aparece na série, mas continua contando no total vitalício.
          lead({ portal: "webmotors", capturado_em: "2026-01-01T12:00:00.000Z" }),
        ],
      });

      const r = await handler(comSessao("https://x/api/numeros"));
      const corpo = await r.json();

      expect(corpo.serie_diaria).toEqual(
        expect.arrayContaining([
          { data: "2026-09-09", portal: "webmotors", total: 2 },
          { data: "2026-09-09", portal: "icarros", total: 1 },
        ]),
      );
      expect(corpo.serie_diaria).toHaveLength(2);

      const webmotors = corpo.itens.find((i: { portal: string }) => i.portal === "webmotors");
      expect(webmotors.total).toBe(3); // vitalício inclui o lead de janeiro
    });

    it("usa o fuso de São Paulo pra definir o dia, não o UTC cru", async () => {
      // 02:30 UTC de 10/09 é 23:30 de 09/09 em São Paulo (UTC-3): tem que
      // cair no dia 09, não no 10.
      mockarSupabase({ leads: [lead({ portal: "olx", capturado_em: "2026-09-10T02:30:00.000Z" })] });

      const r = await handler(comSessao("https://x/api/numeros"));
      const corpo = await r.json();

      expect(corpo.serie_diaria).toEqual([{ data: "2026-09-09", portal: "olx", total: 1 }]);
    });

    it("aceita ?dias= pra reduzir a janela", async () => {
      mockarSupabase({
        leads: [
          lead({ portal: "webmotors", capturado_em: "2026-09-09T15:00:00.000Z" }), // 1 dia atrás: dentro de ?dias=5
          lead({ portal: "webmotors", capturado_em: "2026-08-20T15:00:00.000Z" }), // ~21 dias atrás: fora de ?dias=5
        ],
      });

      const r = await handler(comSessao("https://x/api/numeros?dias=5"));
      const corpo = await r.json();

      expect(corpo.dias).toBe(5);
      expect(corpo.serie_diaria).toEqual([{ data: "2026-09-09", portal: "webmotors", total: 1 }]);
    });

    it("período sem nenhum lead devolve série vazia, não erro", async () => {
      mockarSupabase({
        leads: [lead({ portal: "webmotors", capturado_em: "2020-01-01T12:00:00.000Z" })],
      });

      const r = await handler(comSessao("https://x/api/numeros?dias=5"));
      expect(r.status).toBe(200);
      const corpo = await r.json();

      expect(corpo.serie_diaria).toEqual([]);
    });
  });
});

describe("guarda de sessao de /api/numeros", () => {
  it("recusa com 401 quem chama sem cookie de sessao", async () => {
    const r = await handler(new Request("https://x/api/numeros"));
    expect(r.status).toBe(401);
  });

  it("recusa com 401 cookie assinado com outro segredo", async () => {
    const forjado = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, "outro-segredo")}`;
    const r = await handler(new Request("https://x/api/numeros", { headers: { cookie: forjado } }));
    expect(r.status).toBe(401);
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa em vez de liberar", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    const r = await handler(comSessao("https://x/api/numeros"));
    expect(r.status).toBe(500);
  });
});
