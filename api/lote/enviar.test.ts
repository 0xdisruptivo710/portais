import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_lib/supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("../_lib/ativacao", async (original) => ({
  ...(await original<typeof import("../_lib/ativacao")>()),
  ativarLeadDetalhado: vi.fn(),
}));
vi.mock("../_lib/lote", async (original) => ({
  ...(await original<typeof import("../_lib/lote")>()),
  executarFatia: vi.fn(),
}));

import { getSupabase } from "../_lib/supabase";
import { ativarLeadDetalhado } from "../_lib/ativacao";
import { executarFatia, TETO_POR_LOTE } from "../_lib/lote";
import { assinarSessao, COOKIE_ADMIN } from "../_lib/sessao";

const { POST } = await import("./enviar");

const SEGREDO_SESSAO = "segredo-de-teste-bem-longo-mesmo";

function postar(corpo: unknown, extra: Record<string, string> = {}): Request {
  const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
  return new Request("https://x/api/lote/enviar", {
    method: "POST",
    headers: { cookie, origin: "https://x", "content-type": "application/json", ...extra },
    body: JSON.stringify(corpo),
  });
}

const CONFIG = { horario_inicio: "08:00:00", horario_fim: "20:00:00" };

function mockarSupabase(config: Record<string, unknown> | null = CONFIG) {
  const from = vi.fn((tabela: string) => {
    if (tabela === "portais_config") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: config, error: null })) })),
        })),
      };
    }
    if (tabela === "portais_leads") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: { enviado_em: null }, error: null })) })),
        })),
      };
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });
  vi.mocked(getSupabase).mockReturnValue({ from } as never);
  return from;
}

const FATIA_VAZIA = { resultados: [], restantes: [], parado: null };

beforeEach(() => {
  process.env.ADMIN_SESSION_SECRET = SEGREDO_SESSAO;
  vi.mocked(getSupabase).mockReset();
  vi.mocked(ativarLeadDetalhado).mockReset();
  vi.mocked(executarFatia).mockReset();
  vi.mocked(executarFatia).mockResolvedValue(FATIA_VAZIA);
  vi.useFakeTimers();
  // 11h em São Paulo: dentro da janela padrão de 08:00 às 20:00.
  vi.setSystemTime(new Date("2026-09-12T14:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/lote/enviar", () => {
  it("processa a fatia e devolve resultado, restantes e por que parou", async () => {
    mockarSupabase();
    vi.mocked(executarFatia).mockResolvedValue({
      resultados: [
        { lead_id: 1, situacao: "enviado", motivo: null, verificado: false, verificacao_detalhe: "status QUEUED" },
        { lead_id: 2, situacao: "bloqueado", motivo: "ja existe conversa no WTS", verificado: false, verificacao_detalhe: null },
      ],
      restantes: [3],
      parado: "fatia",
    });

    const r = await POST(postar({ leadIds: [1, 2, 3] }));

    expect(r.status).toBe(200);
    const corpo = await r.json();
    expect(corpo.resultados).toHaveLength(2);
    expect(corpo.restantes).toEqual([3]);
    expect(corpo.parado).toBe("fatia");
    expect(vi.mocked(executarFatia).mock.calls[0][0]).toEqual([1, 2, 3]);
  });

  /**
   * O lote roda por muitos minutos e pode atravessar a noite. O envio de UM
   * lead dispensa a janela de horário (tem uma pessoa olhando para ele
   * naquele instante); o lote não pode dispensar: quem clicou às 19h50 não
   * autorizou mensagem às 21h.
   */
  it("fora da janela de horário não envia nada e devolve a lista inteira intacta", async () => {
    vi.setSystemTime(new Date("2026-09-12T04:00:00.000Z")); // 01h em São Paulo
    mockarSupabase();

    const corpo = await (await POST(postar({ leadIds: [1, 2, 3] }))).json();

    expect(executarFatia).not.toHaveBeenCalled();
    expect(corpo.parado).toBe("fora_da_janela");
    expect(corpo.restantes).toEqual([1, 2, 3]);
    expect(corpo.resultados).toEqual([]);
  });

  it("nunca força a guarda de conversa aberta: no lote ninguém está olhando aquele lead", async () => {
    mockarSupabase();
    vi.mocked(executarFatia).mockImplementation(async (ids, deps) => {
      await deps.ativar(ids[0]);
      return FATIA_VAZIA;
    });

    await POST(postar({ leadIds: [7] }));

    expect(ativarLeadDetalhado).toHaveBeenCalledWith(7, { autorizadoManualmente: true });
  });

  it("a prova de que o lead já recebeu é lida do banco, lead a lead", async () => {
    const from = mockarSupabase();
    vi.mocked(executarFatia).mockImplementation(async (ids, deps) => {
      await deps.jaEnviado(ids[0]);
      return FATIA_VAZIA;
    });

    await POST(postar({ leadIds: [7] }));

    expect(from).toHaveBeenCalledWith("portais_leads");
  });

  it("recusa lote acima do teto em vez de mandar 217 de uma vez", async () => {
    mockarSupabase();
    const ids = Array.from({ length: TETO_POR_LOTE + 1 }, (_, i) => i + 1);

    const r = await POST(postar({ leadIds: ids }));

    expect(r.status).toBe(400);
    expect(executarFatia).not.toHaveBeenCalled();
  });

  it("recusa lista vazia, lista que não é lista e id que não é inteiro positivo", async () => {
    mockarSupabase();
    expect((await POST(postar({ leadIds: [] }))).status).toBe(400);
    expect((await POST(postar({ leadIds: "1,2" }))).status).toBe(400);
    expect((await POST(postar({ leadIds: [1, -3] }))).status).toBe(400);
    expect(executarFatia).not.toHaveBeenCalled();
  });

  it("recusa id repetido: a mesma pessoa não pode entrar duas vezes no mesmo lote", async () => {
    mockarSupabase();

    const r = await POST(postar({ leadIds: [1, 2, 1] }));

    expect(r.status).toBe(400);
    expect(executarFatia).not.toHaveBeenCalled();
  });

  it("devolve 500 quando a config do cliente não existe", async () => {
    mockarSupabase(null);
    expect((await POST(postar({ leadIds: [1] }))).status).toBe(500);
    expect(executarFatia).not.toHaveBeenCalled();
  });
});

describe("guardas de /api/lote/enviar", () => {
  /**
   * Esta é a guarda mais importante do arquivo: atrás dela existe um POST que
   * manda WhatsApp para dezenas de clientes reais.
   */
  it("recusa com 401 quem chama sem cookie de sessao", async () => {
    mockarSupabase();
    const r = await POST(
      new Request("https://x/api/lote/enviar", {
        method: "POST",
        headers: { origin: "https://x", "content-type": "application/json" },
        body: JSON.stringify({ leadIds: [1] }),
      }),
    );
    expect(r.status).toBe(401);
    expect(executarFatia).not.toHaveBeenCalled();
  });

  it("recusa com 403 quem chama de outra origem", async () => {
    mockarSupabase();
    const r = await POST(postar({ leadIds: [1] }, { origin: "https://malicioso.com" }));
    expect(r.status).toBe(403);
    expect(executarFatia).not.toHaveBeenCalled();
  });

  it("recusa com 415 quem não manda application/json", async () => {
    mockarSupabase();
    const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
    const r = await POST(
      new Request("https://x/api/lote/enviar", {
        method: "POST",
        headers: { cookie, origin: "https://x", "content-type": "text/plain" },
        body: JSON.stringify({ leadIds: [1] }),
      }),
    );
    expect(r.status).toBe(415);
    expect(executarFatia).not.toHaveBeenCalled();
  });

  it("sem ADMIN_SESSION_SECRET no ambiente, recusa em vez de liberar", async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    mockarSupabase();
    expect((await POST(postar({ leadIds: [1] }))).status).toBe(500);
    expect(executarFatia).not.toHaveBeenCalled();
  });
});
