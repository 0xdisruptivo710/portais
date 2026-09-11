import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("./_lib/supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "./_lib/supabase";

import { assinarSessao, COOKIE_ADMIN } from "./_lib/sessao";

const { GET, POST } = await import("./enviar");

const SEGREDO_SESSAO = "segredo-de-teste-bem-longo-mesmo";

/**
 * O endpoint que dispara mensagem para cliente real é o mais sensível do
 * painel: os testes de comportamento mandam um cookie válido, e os testes de
 * porta trancada mandam um Request cru, sem cookie nenhum.
 */
function comSessao(url: string, init: RequestInit = {}): Request {
  const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
  return new Request(url, {
    ...init,
    headers: { ...((init.headers ?? {}) as Record<string, string>), cookie },
  });
}

function enviar(corpo: unknown): Promise<Response> {
  return POST(
    comSessao("https://x/api/enviar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
}

const LEAD_BASE = {
  id: 7,
  cliente_slug: "malentachi",
  telefone_e164: "5515991280217",
  telefone_exibicao: "+55 (15) 99128-0217",
  nome: "Fulano da Silva",
  veiculo_texto: "Civic 2020",
  portal: "webmotors",
  status_ativacao: "dry_run",
};

const CFG_BASE = {
  cliente_slug: "malentachi",
  texto_boas_vindas: "Oi {nome}, tudo bem? Vi seu interesse no {veiculo}.",
  wts_from: "5515991280217",
  janela_supressao_dias: 30,
  horario_inicio: "08:00:00",
  horario_fim: "20:00:00",
  // A base real está inteira em dry_run: é exatamente esse o estado em que o
  // botão precisa funcionar, e em que ele precisa NÃO mexer.
  modo_envio: "dry_run",
  kill_switch: false,
};

interface EstadoFrom {
  lead?: Record<string, unknown> | null;
  cfg?: Record<string, unknown>;
  anteriores?: { enviado_em: string | null }[];
}

/**
 * Mesma disciplina de ativacao.test.ts: reconstrói chamada por chamada os
 * encadeamentos reais do Supabase, em vez de um proxy genérico que aceitaria
 * qualquer coisa. O endpoint roda a ativação de verdade por baixo, então o
 * que estes testes provam sobre "não tocar a rede" vale para o caminho real.
 */
function construirFrom(estado: EstadoFrom) {
  const chamadasInsertAtivacao: Record<string, unknown>[] = [];
  const chamadasUpdateAtivacao: Record<string, unknown>[] = [];
  const chamadasUpdateLead: Record<string, unknown>[] = [];
  const chamadasUpdateConfig: Record<string, unknown>[] = [];

  const lead = estado.lead ?? LEAD_BASE;
  const cfg = estado.cfg ?? CFG_BASE;

  const from = vi.fn((tabela: string) => {
    if (tabela === "portais_leads") {
      return {
        select: vi.fn((cols: string) => {
          if (cols === "*") {
            return {
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: lead,
                  error: lead ? null : { message: "lead nao encontrado" },
                })),
              })),
            };
          }
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                not: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(async () => ({ data: estado.anteriores ?? [], error: null })),
                  })),
                })),
              })),
            })),
          };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          chamadasUpdateLead.push(payload);
          return { eq: vi.fn(() => ({ select: vi.fn(async () => ({ data: [{ id: 7 }], error: null })) })) };
        }),
      };
    }
    if (tabela === "portais_config") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: cfg, error: null })) })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          chamadasUpdateConfig.push(payload);
          return { eq: vi.fn(() => ({ select: vi.fn(async () => ({ data: [cfg], error: null })) })) };
        }),
      };
    }
    if (tabela === "portais_ativacoes") {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          chamadasInsertAtivacao.push(payload);
          return { select: vi.fn(async () => ({ data: [{ id: 900 }], error: null })) };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          chamadasUpdateAtivacao.push(payload);
          return { eq: vi.fn(() => ({ select: vi.fn(async () => ({ data: [{ id: 900 }], error: null })) })) };
        }),
      };
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });

  return {
    from,
    chamadasInsertAtivacao,
    chamadasUpdateAtivacao,
    chamadasUpdateLead,
    chamadasUpdateConfig,
  };
}

function mockarSupabase(estado: EstadoFrom = {}) {
  const construido = construirFrom(estado);
  vi.mocked(getSupabase).mockReturnValue({ from: construido.from } as never);
  return construido;
}

function mockarFetchWts(statusDaMensagem: unknown = { status: "DELIVERED" }) {
  fetchMock.mockImplementation(async (url: unknown) => {
    const alvo = String(url);
    if (alvo.endsWith("/chat/v1/message/send")) {
      return { ok: true, text: async () => JSON.stringify({ id: "msg-1", status: "QUEUED" }) };
    }
    if (alvo.endsWith("/status")) {
      return { ok: true, text: async () => JSON.stringify(statusDaMensagem) };
    }
    throw new Error(`url inesperada no mock: ${alvo}`);
  });
}

function chamadasDeEnvio(): unknown[] {
  return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/chat/v1/message/send"));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(getSupabase).mockReset();
  process.env.ADMIN_SESSION_SECRET = SEGREDO_SESSAO;
  process.env.WTS_TOKEN = "token-de-teste";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.WTS_TOKEN;
});

describe("POST /api/enviar: porta trancada", () => {
  it("sem sessao devolve 401 e nao toca no banco nem na rede", async () => {
    const resposta = await POST(
      new Request("https://x/api/enviar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: 7 }),
      }),
    );

    expect(resposta.status).toBe(401);
    expect(vi.mocked(getSupabase)).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("GET da previa sem sessao devolve 401", async () => {
    const resposta = await GET(new Request("https://x/api/enviar?leadId=7"));

    expect(resposta.status).toBe(401);
    expect(vi.mocked(getSupabase)).not.toHaveBeenCalled();
  });

  it("leadId ausente ou invalido devolve 400 sem tocar no banco", async () => {
    for (const corpo of [{}, { leadId: "abc" }, { leadId: 0 }, { leadId: -1 }, { leadId: 1.5 }]) {
      const resposta = await enviar(corpo);
      expect(resposta.status).toBe(400);
    }
    expect(vi.mocked(getSupabase)).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/enviar: guardas que nao podem ser contornadas pelo botao", () => {
  it("lead sem telefone: nao chama a rede e devolve o motivo legivel", async () => {
    mockarSupabase({ lead: { ...LEAD_BASE, telefone_e164: null, telefone_exibicao: null } });

    const resposta = await enviar({ leadId: 7 });
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.enviado).toBe(false);
    expect(corpo.acao).toBe("suprimido");
    expect(corpo.motivo).toBe("sem telefone normalizavel");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("telefone ja contatado dentro da janela: suprimido, e a rede NUNCA e tocada", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarSupabase({ anteriores: [{ enviado_em: "2026-09-07T13:00:00-03:00" }] });

    const resposta = await enviar({ leadId: 7 });
    const corpo = await resposta.json();

    expect(corpo.enviado).toBe(false);
    expect(corpo.acao).toBe("suprimido");
    expect(corpo.motivo).toContain("contatado ha 3d");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kill-switch ligado: suprimido, e a rede NUNCA e tocada", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarSupabase({ cfg: { ...CFG_BASE, kill_switch: true } });

    const resposta = await enviar({ leadId: 7 });
    const corpo = await resposta.json();

    expect(corpo.enviado).toBe(false);
    expect(corpo.motivo).toBe("kill-switch ligado");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/enviar: caminho feliz", () => {
  it("chama o envio uma unica vez, grava enviado_em e a auditoria com a resposta do WTS", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts();
    const { chamadasUpdateLead, chamadasInsertAtivacao, chamadasUpdateAtivacao } = mockarSupabase();

    const resposta = await enviar({ leadId: 7 });
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.enviado).toBe(true);
    expect(corpo.acao).toBe("enviar");
    expect(corpo.resposta_wts).toEqual({ id: "msg-1", status: "QUEUED" });

    // Um envio, nunca dois. A consulta de status é outra chamada e é contada
    // à parte de propósito.
    expect(chamadasDeEnvio()).toHaveLength(1);

    const gravacao = chamadasUpdateLead.find((c) => c.status_ativacao === "enviado");
    expect(gravacao?.enviado_em).toBe(new Date("2026-09-10T13:00:00-03:00").toISOString());
    expect(chamadasInsertAtivacao).toHaveLength(1);
    expect(chamadasInsertAtivacao[0].modo).toBe("manual");
    expect(chamadasUpdateAtivacao[0].resposta_wts).toEqual({ id: "msg-1", status: "QUEUED" });
  });

  // O botão autoriza um envio, não liga o envio automático para a base toda.
  it("modo_envio continua dry_run depois do envio manual", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts();
    const { chamadasUpdateConfig } = mockarSupabase();

    await enviar({ leadId: 7 });

    expect(chamadasUpdateConfig).toHaveLength(0);
  });

  it("devolve o resultado da conferencia sem transformar QUEUED em entrega", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts({ status: "QUEUED" });
    mockarSupabase();

    const corpo = await (await enviar({ leadId: 7 })).json();

    expect(corpo.enviado).toBe(true);
    expect(corpo.verificado).toBe(false);
    expect(corpo.verificacao_detalhe).toContain("QUEUED");
  });

  it("fora da janela de horario o envio manual sai, marcado como manual_fora_janela", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T21:30:00-03:00"));
    mockarFetchWts();
    const { chamadasInsertAtivacao } = mockarSupabase();

    const corpo = await (await enviar({ leadId: 7 })).json();

    expect(corpo.enviado).toBe(true);
    expect(chamadasInsertAtivacao[0].modo).toBe("manual_fora_janela");
  });

  it("falha do WTS vira erro legivel, nao um sucesso silencioso", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    fetchMock.mockResolvedValue({ ok: false, status: 422, text: async () => "numero invalido" });
    mockarSupabase();

    const resposta = await enviar({ leadId: 7 });
    const corpo = await resposta.json();

    expect(resposta.status).toBe(502);
    expect(String(corpo.erro)).toContain("422");
  });
});

describe("GET /api/enviar: previa da mensagem", () => {
  it("devolve o texto exato e o destino, sem tocar a rede", async () => {
    mockarSupabase();

    const resposta = await GET(comSessao("https://x/api/enviar?leadId=7"));
    const corpo = await resposta.json();

    expect(resposta.status).toBe(200);
    expect(corpo.texto).toContain("Fulano");
    expect(corpo.texto).toContain("Civic 2020");
    expect(corpo.telefone_exibicao).toBe("+55 (15) 99128-0217");
    expect(corpo.para).toBe("+55|15991280217");
    expect(corpo.bloqueado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("avisa que o telefone ja recebeu mensagem, com ha quantos dias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarSupabase({ anteriores: [{ enviado_em: "2026-09-07T13:00:00-03:00" }] });

    const corpo = await (await GET(comSessao("https://x/api/enviar?leadId=7"))).json();

    expect(corpo.dias_desde_ultimo_contato).toBe(3);
    expect(corpo.bloqueado).toBe(true);
    expect(corpo.motivo).toContain("contatado ha 3d");
  });

  it("leadId invalido devolve 400 sem tocar no banco", async () => {
    const resposta = await GET(comSessao("https://x/api/enviar?leadId=abc"));

    expect(resposta.status).toBe(400);
    expect(vi.mocked(getSupabase)).not.toHaveBeenCalled();
  });
});
