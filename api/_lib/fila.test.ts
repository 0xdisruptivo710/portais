import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

vi.mock("./supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("./processar", () => ({ processarEvento: vi.fn() }));
vi.mock("./ativacao", () => ({ ativarLead: vi.fn() }));

import { getSupabase } from "./supabase";
import { processarEvento } from "./processar";
import { ativarLead } from "./ativacao";

// A ativação de verdade, sem o dublê, para o teste de ponta a ponta do
// dry_run: é o único jeito de provar que drenar a fila produz a linha de
// auditoria em portais_ativacoes sem tocar na rede.
const { ativarLead: ativarLeadReal } = await vi.importActual<typeof import("./ativacao")>("./ativacao");

const { ativarPendentes, interpretarPendentes, TETO_PADRAO } = await import("./fila");

const COLUNA_STATUS: Record<string, string> = {
  portais_eventos_raw: "status",
  portais_leads: "status_ativacao",
};

interface EstadoBanco {
  /** Linhas em memória por tabela. O update do dublê muda a linha de verdade. */
  linhas: Record<string, Record<string, unknown>[]>;
  erroSelect?: string;
  /** Simula o update que "dá 200" mas não acha a linha (cicatriz do PostgREST). */
  updateVazio?: boolean;
}

/**
 * Banco em memória, não proxy genérico: filtra por status, respeita o cursor
 * e a página, e o update muda a linha. Assim o teste prova que a fila esvazia
 * de verdade — um drenador que não tirasse a linha da fila entraria em loop
 * aqui em vez de passar calado.
 */
function criarBanco(estado: EstadoBanco) {
  const chamadasSelect: { tabela: string; coluna: string; valor: unknown; cursor: number; ate: number }[] = [];
  const chamadasUpdate: { tabela: string; id: number; payload: Record<string, unknown> }[] = [];

  const from = vi.fn((tabela: string) => ({
    select: vi.fn(() => {
      let coluna = "";
      let valor: unknown;
      let cursor = 0;
      const consulta = {
        eq: vi.fn((c: string, v: unknown) => {
          coluna = c;
          valor = v;
          return consulta;
        }),
        gt: vi.fn((_c: string, v: number) => {
          cursor = v;
          return consulta;
        }),
        order: vi.fn(() => consulta),
        range: vi.fn(async (de: number, ate: number) => {
          chamadasSelect.push({ tabela, coluna, valor, cursor, ate });
          if (estado.erroSelect) return { data: null, error: { message: estado.erroSelect } };
          const linhas = (estado.linhas[tabela] ?? [])
            .filter((l) => l[coluna] === valor && Number(l.id) > cursor)
            .sort((a, b) => Number(a.id) - Number(b.id))
            .slice(de, ate + 1)
            .map((l) => ({ id: Number(l.id) }));
          return { data: linhas, error: null };
        }),
      };
      return consulta;
    }),
    update: vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn((_c: string, id: number) => ({
        select: vi.fn(async () => {
          chamadasUpdate.push({ tabela, id, payload });
          const linha = (estado.linhas[tabela] ?? []).find((l) => Number(l.id) === id);
          if (!linha || estado.updateVazio) return { data: [], error: null };
          Object.assign(linha, payload);
          return { data: [{ id }], error: null };
        }),
      })),
    })),
  }));

  vi.mocked(getSupabase).mockReturnValue({ from } as never);
  return { from, chamadasSelect, chamadasUpdate };
}

function eventos(quantidade: number, status = "novo") {
  return Array.from({ length: quantidade }, (_, i) => ({ id: i + 1, status }));
}

function leads(quantidade: number, status = "pendente") {
  return Array.from({ length: quantidade }, (_, i) => ({ id: i + 1, status_ativacao: status }));
}

/** Dublê fiel: processar/ativar tiram a linha da fila, como o código real faz. */
function tiraDaFila(tabela: string, estado: EstadoBanco, novoValor: string) {
  return async (id: number) => {
    const linha = (estado.linhas[tabela] ?? []).find((l) => Number(l.id) === id);
    if (linha) linha[COLUNA_STATUS[tabela]] = novoValor;
    return "lead" as never;
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.mocked(getSupabase).mockReset();
  vi.mocked(processarEvento).mockReset();
  vi.mocked(ativarLead).mockReset();
});

describe("interpretarPendentes", () => {
  it("drena evento pre-existente com status novo, nao so o que acabou de chegar", async () => {
    // O evento 7 já estava gravado antes desta execução: é exatamente o caso
    // que o cron antigo (que só processava o que ele mesmo ingeriu) perdia.
    const estado: EstadoBanco = { linhas: { portais_eventos_raw: [{ id: 7, status: "novo" }] } };
    const { chamadasSelect } = criarBanco(estado);
    vi.mocked(processarEvento).mockImplementation(tiraDaFila("portais_eventos_raw", estado, "parseado"));

    const resumo = await interpretarPendentes();

    expect(vi.mocked(processarEvento)).toHaveBeenCalledWith(7);
    expect(resumo).toEqual({ processado: 1, falha: 0 });
    expect(chamadasSelect[0]).toMatchObject({ tabela: "portais_eventos_raw", coluna: "status", valor: "novo" });
  });

  it("pagina a fila em vez de tentar puxar tudo de uma vez", async () => {
    const estado: EstadoBanco = { linhas: { portais_eventos_raw: eventos(120) } };
    const { chamadasSelect } = criarBanco(estado);
    vi.mocked(processarEvento).mockImplementation(tiraDaFila("portais_eventos_raw", estado, "parseado"));

    const resumo = await interpretarPendentes();

    expect(resumo.processado).toBe(120);
    expect(chamadasSelect.length).toBeGreaterThan(1);
    // Toda página pede uma faixa limitada, nunca a tabela inteira.
    for (const chamada of chamadasSelect) expect(chamada.ate).toBeLessThan(TETO_PADRAO);
    // O cursor anda: a segunda página começa depois do último id da primeira.
    expect(chamadasSelect[1].cursor).toBeGreaterThan(0);
  });

  it("um evento que estoura nao impede os outros e fica marcado como falhou", async () => {
    const estado: EstadoBanco = { linhas: { portais_eventos_raw: eventos(3) } };
    const { chamadasUpdate } = criarBanco(estado);
    const tirar = tiraDaFila("portais_eventos_raw", estado, "parseado");
    vi.mocked(processarEvento).mockImplementation(async (id: number) => {
      if (id === 2) throw new Error("parser estourou");
      return tirar(id);
    });

    const resumo = await interpretarPendentes();

    expect(resumo).toEqual({ processado: 2, falha: 1 });
    expect(vi.mocked(processarEvento)).toHaveBeenCalledWith(3);
    expect(chamadasUpdate).toEqual([{ tabela: "portais_eventos_raw", id: 2, payload: { status: "falhou" } }]);
    // A linha que estourou sai da fila: sem isso, toda execução seguinte
    // tentaria o mesmo evento quebrado antes de chegar nos novos.
    expect(estado.linhas.portais_eventos_raw.find((l) => l.id === 2)?.status).toBe("falhou");
  });

  it("respeita o teto de itens por execucao", async () => {
    const estado: EstadoBanco = { linhas: { portais_eventos_raw: eventos(TETO_PADRAO + 50) } };
    criarBanco(estado);
    vi.mocked(processarEvento).mockImplementation(tiraDaFila("portais_eventos_raw", estado, "parseado"));

    const resumo = await interpretarPendentes();

    expect(resumo.processado).toBe(TETO_PADRAO);
  });

  it("aceita teto maior, para o backfill do script nao parar no meio", async () => {
    const estado: EstadoBanco = { linhas: { portais_eventos_raw: eventos(TETO_PADRAO + 50) } };
    criarBanco(estado);
    vi.mocked(processarEvento).mockImplementation(tiraDaFila("portais_eventos_raw", estado, "parseado"));

    const resumo = await interpretarPendentes({ teto: TETO_PADRAO + 50 });

    expect(resumo.processado).toBe(TETO_PADRAO + 50);
  });

  it("erro na consulta da fila propaga, em vez de virar fila vazia", async () => {
    criarBanco({ linhas: {}, erroSelect: "boom" });

    await expect(interpretarPendentes()).rejects.toThrow(/boom/);
  });

  it("falha ao marcar falhou nao derruba o lote nem trava a varredura", async () => {
    const estado: EstadoBanco = { linhas: { portais_eventos_raw: eventos(2) }, updateVazio: true };
    criarBanco(estado);
    vi.mocked(processarEvento).mockRejectedValue(new Error("parser estourou"));

    const resumo = await interpretarPendentes();

    // Nenhuma linha saiu da fila (o update não gravou), mas o cursor garante
    // que cada id é tentado uma vez só e a execução termina.
    expect(resumo).toEqual({ processado: 0, falha: 2 });
  });
});

describe("ativarPendentes", () => {
  it("drena lead pendente chamando ativarLead", async () => {
    const estado: EstadoBanco = { linhas: { portais_leads: leads(2) } };
    const { chamadasSelect } = criarBanco(estado);
    vi.mocked(ativarLead).mockImplementation(tiraDaFila("portais_leads", estado, "dry_run"));

    const resumo = await ativarPendentes();

    expect(vi.mocked(ativarLead)).toHaveBeenCalledWith(1);
    expect(vi.mocked(ativarLead)).toHaveBeenCalledWith(2);
    expect(resumo).toEqual({ processado: 2, falha: 0 });
    expect(chamadasSelect[0]).toMatchObject({ coluna: "status_ativacao", valor: "pendente" });
  });

  it("um lead que rejeita nao impede os outros e fica com status_ativacao falhou", async () => {
    // ativarLead propaga erro como rejeição (a união Acao não tem 'falhou'),
    // então quem drena é que precisa registrar o estado.
    const estado: EstadoBanco = { linhas: { portais_leads: leads(3) } };
    const { chamadasUpdate } = criarBanco(estado);
    const tirar = tiraDaFila("portais_leads", estado, "dry_run");
    vi.mocked(ativarLead).mockImplementation(async (id: number) => {
      if (id === 2) throw new Error("wts fora do ar");
      return tirar(id);
    });

    const resumo = await ativarPendentes();

    expect(resumo).toEqual({ processado: 2, falha: 1 });
    expect(vi.mocked(ativarLead)).toHaveBeenCalledWith(3);
    expect(chamadasUpdate).toEqual([
      { tabela: "portais_leads", id: 2, payload: { status_ativacao: "falhou" } },
    ]);
  });
});

const CFG_DRY_RUN = {
  cliente_slug: "malentachi",
  texto_boas_vindas: "Oi {nome}, tudo bem? Vi seu interesse no {veiculo} pelo {portal}.",
  wts_from: "5515991280217",
  janela_supressao_dias: 30,
  horario_inicio: "08:00:00",
  horario_fim: "20:00:00",
  modo_envio: "dry_run",
  kill_switch: false,
};

/**
 * Dublê do Supabase que atende a fila E a ativação de verdade, para o teste
 * de ponta a ponta abaixo (critério de aceite 6 da spec).
 */
function bancoDaAtivacaoReal() {
  const linhas = [{ id: 1, status_ativacao: "pendente" }];
  const insertsAtivacao: Record<string, unknown>[] = [];

  const from = vi.fn((tabela: string) => {
    if (tabela === "portais_leads") {
      return {
        select: vi.fn((cols: string) => {
          if (cols === "*") {
            return {
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: {
                    id: 1,
                    cliente_slug: "malentachi",
                    telefone_e164: "5515991280217",
                    nome: "Fulano da Silva",
                    veiculo_texto: "Civic 2020",
                    portal: "webmotors",
                  },
                  error: null,
                })),
              })),
            };
          }
          if (cols === "enviado_em") {
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  not: vi.fn(() => ({
                    order: vi.fn(() => ({ limit: vi.fn(async () => ({ data: [], error: null })) })),
                  })),
                })),
              })),
            };
          }
          // cols === "id": a consulta da própria fila.
          let cursor = 0;
          const consulta = {
            eq: vi.fn(() => consulta),
            gt: vi.fn((_c: string, v: number) => {
              cursor = v;
              return consulta;
            }),
            order: vi.fn(() => consulta),
            range: vi.fn(async () => ({
              data: linhas.filter((l) => l.status_ativacao === "pendente" && l.id > cursor).map((l) => ({ id: l.id })),
              error: null,
            })),
          };
          return consulta;
        }),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((_c: string, id: number) => ({
            select: vi.fn(async () => {
              const linha = linhas.find((l) => l.id === id);
              if (linha) Object.assign(linha, payload);
              return { data: [{ id }], error: null };
            }),
          })),
        })),
      };
    }
    if (tabela === "portais_config") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: CFG_DRY_RUN, error: null })) })),
        })),
      };
    }
    if (tabela === "portais_ativacoes") {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          insertsAtivacao.push(payload);
          return { select: vi.fn(async () => ({ data: [{ id: 501 }], error: null })) };
        }),
      };
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });

  vi.mocked(getSupabase).mockReturnValue({ from } as never);
  return { insertsAtivacao, linhas };
}

describe("ativarPendentes em dry_run, com a ativacao de verdade", () => {
  it("grava a linha de auditoria em portais_ativacoes e nunca chama fetch", async () => {
    const { insertsAtivacao, linhas } = bancoDaAtivacaoReal();
    vi.mocked(ativarLead).mockImplementation(ativarLeadReal);

    const resumo = await ativarPendentes();

    expect(resumo).toEqual({ processado: 1, falha: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(insertsAtivacao).toHaveLength(1);
    expect(insertsAtivacao[0].modo).toBe("dry_run");
    const payload = insertsAtivacao[0].payload_enviado as { body: { text: string } } | null;
    expect(payload?.body.text).toContain("Fulano");
    expect(linhas[0].status_ativacao).toBe("dry_run");
  });
});
