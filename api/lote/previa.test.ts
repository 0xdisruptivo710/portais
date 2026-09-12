import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_lib/supabase", () => ({ getSupabase: vi.fn() }));

import { getSupabase } from "../_lib/supabase";
import { TETO_POR_LOTE } from "../_lib/lote";
import { assinarSessao, COOKIE_ADMIN } from "../_lib/sessao";

const { POST } = await import("./previa");

const SEGREDO_SESSAO = "segredo-de-teste-bem-longo-mesmo";

function postar(corpo: unknown, extra: Record<string, string> = {}): Request {
  const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
  return new Request("https://x/api/lote/previa", {
    method: "POST",
    headers: { cookie, origin: "https://x", "content-type": "application/json", ...extra },
    body: JSON.stringify(corpo),
  });
}

const CONFIG = {
  kill_switch: false,
  wts_from: "5515999990000",
  texto_boas_vindas: "Oi {nome}, tudo bem? Vi seu interesse no{veiculo}.",
  janela_supressao_dias: 30,
  horario_inicio: "08:00:00",
  horario_fim: "20:00:00",
};

interface Estado {
  config?: Record<string, unknown> | null;
  leads?: Record<string, unknown>[];
  contatos?: { telefone_e164: string; enviado_em: string }[];
  erroLeads?: { message: string } | null;
}

/**
 * Reconstrói, chamada por chamada, os encadeamentos reais do handler — mesmo
 * padrão de processar.test.ts — para que um erro de encadeamento no código de
 * produção quebre o teste em vez de passar calado.
 */
function mockarSupabase(estado: Estado) {
  const idsConsultados: unknown[][] = [];

  const from = vi.fn((tabela: string) => {
    if (tabela === "portais_config") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: estado.config === undefined ? CONFIG : estado.config,
              error: null,
            })),
          })),
        })),
      };
    }
    if (tabela === "portais_leads") {
      return {
        select: vi.fn((cols: string) => {
          if (cols === "telefone_e164,enviado_em") {
            return {
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  not: vi.fn(async () => ({ data: estado.contatos ?? [], error: null })),
                })),
              })),
            };
          }
          return {
            in: vi.fn((_coluna: string, ids: unknown[]) => {
              idsConsultados.push(ids);
              return Promise.resolve({
                data: estado.erroLeads ? null : (estado.leads ?? []),
                error: estado.erroLeads ?? null,
              });
            }),
          };
        }),
      };
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });

  vi.mocked(getSupabase).mockReturnValue({ from } as never);
  return { from, idsConsultados };
}

function lead(id: number, telefone: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    portal: "webmotors",
    nome: "Fulano",
    veiculo_texto: "Civic 2020",
    telefone_e164: telefone,
    enviado_em: null,
    ...extra,
  };
}

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SEGREDO_SESSAO;
  vi.mocked(getSupabase).mockReset();
  vi.useFakeTimers();
  // 11h em São Paulo: dentro da janela padrão de 08:00 às 20:00.
  vi.setSystemTime(new Date("2026-09-12T14:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/lote/previa", () => {
  it("conta as mensagens, as pessoas distintas e os bloqueados", async () => {
    mockarSupabase({
      leads: [lead(1, "5515991280217"), lead(2, "5515991280218"), lead(3, null)],
    });

    const r = await POST(postar({ leadIds: [1, 2, 3] }));

    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo).toMatchObject({ selecionados: 3, vao_sair: 2, pessoas: 2, bloqueados: 1 });
    expect(corpo.motivos[0].motivo).toMatch(/sem telefone/i);
  });

  /**
   * "Todos" é o que o filtro mostra, e o filtro pode mostrar 217. O teto do
   * lote corta, e a prévia precisa dizer quantos ficaram de fora — senão o
   * operador acha que mandou para todo mundo.
   */
  it("corta no teto do lote e devolve quantos ficaram para o próximo", async () => {
    const ids = Array.from({ length: TETO_POR_LOTE + 7 }, (_, i) => i + 1);
    mockarSupabase({ leads: ids.map((id) => lead(id, `551599128${String(1000 + id).padStart(4, "0")}`)) });

    const corpo = await (await POST(postar({ leadIds: ids }))).json();

    expect(corpo.selecionados).toBe(ids.length);
    expect(corpo.no_lote).toBe(TETO_POR_LOTE);
    expect(corpo.acima_do_teto).toBe(7);
    expect(corpo.ids).toHaveLength(TETO_POR_LOTE);
    expect(corpo.teto).toBe(TETO_POR_LOTE);
  });

  /**
   * O envio segue a ordem do que o operador está vendo na tela, não a ordem
   * em que o PostgREST devolveu as linhas: o corte do teto tem que pegar os
   * primeiros da lista dele.
   */
  it("respeita a ordem em que os ids chegaram, não a do banco", async () => {
    mockarSupabase({ leads: [lead(1, "5515991280217"), lead(2, "5515991280218")] });

    const corpo = await (await POST(postar({ leadIds: [2, 1] }))).json();

    expect(corpo.ids).toEqual([2, 1]);
  });

  it("id que não existe mais some do lote em vez de virar linha fantasma", async () => {
    mockarSupabase({ leads: [lead(1, "5515991280217")] });

    const corpo = await (await POST(postar({ leadIds: [1, 999] }))).json();

    expect(corpo.ids).toEqual([1]);
    expect(corpo.no_lote).toBe(1);
  });

  it("telefone contatado dentro da janela já aparece bloqueado na prévia", async () => {
    mockarSupabase({
      leads: [lead(1, "5515991280217")],
      contatos: [{ telefone_e164: "5515991280217", enviado_em: "2026-09-10T12:00:00.000Z" }],
    });

    const corpo = await (await POST(postar({ leadIds: [1] }))).json();

    expect(corpo.vao_sair).toBe(0);
    expect(corpo.bloqueados).toBe(1);
    expect(corpo.motivos[0].motivo).toMatch(/janela/);
  });

  /**
   * A consulta de conversa aberta custa duas chamadas ao WTS por lead:
   * gastá-las na prévia consumiria a mesma cota que o envio precisa. A tela
   * tem que dizer isso, em vez de deixar o operador achar que a prévia é a
   * palavra final.
   */
  it("avisa que a conferência de conversa no WTS só acontece no envio", async () => {
    mockarSupabase({ leads: [lead(1, "5515991280217")] });

    const corpo = await (await POST(postar({ leadIds: [1] }))).json();

    expect(corpo.conversa_wts_confere_no_envio).toBe(true);
  });

  it("devolve o ritmo e a janela, que é o que a confirmação precisa dizer", async () => {
    mockarSupabase({ leads: [lead(1, "5515991280217")] });

    const corpo = await (await POST(postar({ leadIds: [1] }))).json();

    expect(corpo.pausa_segundos).toBe(12);
    expect(corpo.janela).toMatchObject({ aberta: true, inicio: "08:00", fim: "20:00" });
  });

  it("fora da janela de horário, a prévia já diz que o lote não vai começar", async () => {
    vi.setSystemTime(new Date("2026-09-12T04:00:00.000Z")); // 01h em São Paulo
    mockarSupabase({ leads: [lead(1, "5515991280217")] });

    const corpo = await (await POST(postar({ leadIds: [1] }))).json();

    expect(corpo.janela.aberta).toBe(false);
  });
});

describe("POST /api/lote/previa: entrada malformada", () => {
  it("recusa json invalido", async () => {
    mockarSupabase({});
    const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
    const r = await POST(
      new Request("https://x/api/lote/previa", {
        method: "POST",
        headers: { cookie, origin: "https://x", "content-type": "application/json" },
        body: "{invalido",
      }),
    );
    expect(r.status).toBe(400);
  });

  it("recusa leadIds que não é lista", async () => {
    mockarSupabase({});
    expect((await POST(postar({ leadIds: 7 }))).status).toBe(400);
  });

  it("recusa lista vazia", async () => {
    mockarSupabase({});
    expect((await POST(postar({ leadIds: [] }))).status).toBe(400);
  });

  it("recusa id que não é inteiro positivo", async () => {
    mockarSupabase({});
    expect((await POST(postar({ leadIds: [1, "dois"] }))).status).toBe(400);
    expect((await POST(postar({ leadIds: [1, 0] }))).status).toBe(400);
  });

  it("devolve 500 quando o banco falha, sem mascarar como lote vazio", async () => {
    mockarSupabase({ leads: [], erroLeads: { message: "boom" } });
    expect((await POST(postar({ leadIds: [1] }))).status).toBe(500);
  });

  it("devolve 500 quando a config do cliente não existe", async () => {
    mockarSupabase({ config: null });
    expect((await POST(postar({ leadIds: [1] }))).status).toBe(500);
  });
});

describe("guardas de /api/lote/previa", () => {
  it("recusa com 401 quem chama sem cookie de sessao", async () => {
    const { from } = mockarSupabase({});
    const r = await POST(
      new Request("https://x/api/lote/previa", {
        method: "POST",
        headers: { origin: "https://x", "content-type": "application/json" },
        body: JSON.stringify({ leadIds: [1] }),
      }),
    );
    expect(r.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });

  it("recusa com 403 quem chama de outra origem", async () => {
    mockarSupabase({});
    const r = await POST(postar({ leadIds: [1] }, { origin: "https://malicioso.com" }));
    expect(r.status).toBe(403);
  });
});
