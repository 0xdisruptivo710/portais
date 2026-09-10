import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocka no mesmo estilo do padrão da casa (ingestao.test.ts): substitui o
// módulo inteiro por um dublê e importa a função já mockada depois.
vi.mock("./supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("./parsers/index", () => ({ parserDoPortal: vi.fn() }));
vi.mock("./ia", () => ({ extrairComIa: vi.fn() }));

import { getSupabase } from "./supabase";
import { parserDoPortal } from "./parsers/index";
import { extrairComIa } from "./ia";
import { processarEvento } from "./processar";

const LEAD_PARSER = {
  nome: "Fulano da Silva",
  telefone: "15991280217",
  email: null,
  veiculoTexto: "Honda Civic 2020",
  anuncioUrl: null,
  anuncioIdExterno: null,
  mensagemLead: "Quero saber o preço",
};

const LEAD_IA = {
  nome: "Maria Souza",
  telefone: "15991280218",
  email: null,
  veiculoTexto: null,
  anuncioUrl: null,
  anuncioIdExterno: null,
  mensagemLead: null,
};

function eventoBase(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    portal: "webmotors",
    message_id: "<abc@webmotors.com.br>",
    remetente: "leads@webmotors.com.br",
    assunto: "Novo lead",
    recebido_em: "2026-09-10T12:00:00.000Z",
    corpo_texto: "corpo",
    corpo_html: "<p>corpo</p>",
    anexos: [],
    ...overrides,
  };
}

interface EstadoFrom {
  evento: Record<string, unknown> | null;
  config?: { ia_teto_dia_usd: number; ia_teto_evento_usd: number };
  gastoHoje?: { ia_custo_usd: number | null }[];
  estoque?: unknown[];
  upsertResultado?: { data: unknown; error: unknown };
  updateResultado?: { data: unknown; error: unknown };
}

/**
 * Reconstrói, chamada por chamada, os encadeamentos reais que
 * processarEvento faz no Supabase — não um proxy genérico — para que um erro
 * de encadeamento no código de produção quebre o teste em vez de passar calado.
 */
function construirFrom(estado: EstadoFrom) {
  const chamadasUpdate: Record<string, unknown>[] = [];
  const chamadasUpsertLead: { payload: Record<string, unknown>; opts: unknown }[] = [];

  const upsertResultado = estado.upsertResultado ?? { data: [{ id: 99 }], error: null };
  const updateResultado = estado.updateResultado ?? { data: [{ id: 1 }], error: null };

  const from = vi.fn((tabela: string) => {
    if (tabela === "portais_eventos_raw") {
      return {
        select: vi.fn((cols: string) => {
          if (cols === "*") {
            return {
              eq: vi.fn(() => ({
                single: vi.fn(async () => ({ data: estado.evento, error: null })),
              })),
            };
          }
          // cols === "ia_custo_usd", usado por gastoDeHoje
          return { gte: vi.fn(async () => ({ data: estado.gastoHoje ?? [], error: null })) };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          chamadasUpdate.push(payload);
          return { eq: vi.fn(() => ({ select: vi.fn(async () => updateResultado) })) };
        }),
      };
    }
    if (tabela === "portais_config") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: estado.config ?? { ia_teto_dia_usd: 2, ia_teto_evento_usd: 0.05 },
              error: null,
            })),
          })),
        })),
      };
    }
    if (tabela === "estoque_malentachi") {
      return { select: vi.fn(async () => ({ data: estado.estoque ?? [], error: null })) };
    }
    if (tabela === "portais_leads") {
      return {
        upsert: vi.fn((payload: Record<string, unknown>, opts: unknown) => {
          chamadasUpsertLead.push({ payload, opts });
          return { select: vi.fn(async () => upsertResultado) };
        }),
      };
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });

  return { from, chamadasUpdate, chamadasUpsertLead };
}

function mockarSupabase(estado: EstadoFrom) {
  const construido = construirFrom(estado);
  vi.mocked(getSupabase).mockReturnValue({ from: construido.from } as never);
  return construido;
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
  vi.mocked(parserDoPortal).mockReset();
  vi.mocked(extrairComIa).mockReset();
});

describe("processarEvento", () => {
  it("portal fora de PORTAIS_COM_DADOS grava lead sem dados, sem chamar parser nem IA", async () => {
    const { chamadasUpsertLead } = mockarSupabase({ evento: eventoBase({ portal: "olx" }) });

    const resultado = await processarEvento(1);

    expect(resultado).toBe("sem_dados");
    expect(parserDoPortal).not.toHaveBeenCalled();
    expect(extrairComIa).not.toHaveBeenCalled();
    expect(chamadasUpsertLead).toHaveLength(1);
    expect(chamadasUpsertLead[0].payload.metodo).toBe("manual");
    expect(chamadasUpsertLead[0].payload.confianca).toBe("baixa");
    expect(chamadasUpsertLead[0].payload.nome).toBeNull();
  });

  it("parser determinístico devolve lead: não chama a IA", async () => {
    const { chamadasUpsertLead } = mockarSupabase({ evento: eventoBase({ portal: "webmotors" }) });
    vi.mocked(parserDoPortal).mockReturnValue(() => LEAD_PARSER);

    const resultado = await processarEvento(1);

    expect(resultado).toBe("lead");
    expect(extrairComIa).not.toHaveBeenCalled();
    expect(chamadasUpsertLead[0].payload.metodo).toBe("parser");
    expect(chamadasUpsertLead[0].payload.confianca).toBe("alta");
    expect(chamadasUpsertLead[0].payload.nome).toBe("Fulano da Silva");
  });

  it("parser devolve null e a IA devolve lead: grava com metodo ia e confianca media", async () => {
    const { chamadasUpsertLead, chamadasUpdate } = mockarSupabase({ evento: eventoBase({ portal: "webmotors" }) });
    vi.mocked(parserDoPortal).mockReturnValue(() => null);
    vi.mocked(extrairComIa).mockResolvedValue({ lead: LEAD_IA, custoUsd: 0.004 });

    const resultado = await processarEvento(1);

    expect(resultado).toBe("lead");
    expect(chamadasUpsertLead[0].payload.metodo).toBe("ia");
    expect(chamadasUpsertLead[0].payload.confianca).toBe("media");
    expect(chamadasUpsertLead[0].payload.nome).toBe("Maria Souza");
    expect(chamadasUpdate.some((c) => c.status === "parseado")).toBe(true);
  });

  // Este é o teste da fila de revisão: a rede de segurança que garante que
  // nenhum lead se perde quando parser e IA falham os dois.
  it("parser e IA devolvem null: cai na fila de revisão", async () => {
    const { chamadasUpsertLead, chamadasUpdate } = mockarSupabase({ evento: eventoBase({ portal: "webmotors" }) });
    vi.mocked(parserDoPortal).mockReturnValue(() => null);
    vi.mocked(extrairComIa).mockResolvedValue({ lead: null, custoUsd: 0 });

    const resultado = await processarEvento(1);

    expect(resultado).toBe("revisao");
    expect(chamadasUpsertLead).toHaveLength(0);
    expect(chamadasUpdate.some((c) => c.status === "revisao")).toBe(true);
  });

  it("grava ia_usada e ia_custo_usd no evento quando a IA é usada com custo maior que zero", async () => {
    const { chamadasUpdate } = mockarSupabase({ evento: eventoBase({ portal: "webmotors" }) });
    vi.mocked(parserDoPortal).mockReturnValue(() => null);
    vi.mocked(extrairComIa).mockResolvedValue({ lead: null, custoUsd: 0.004 });

    await processarEvento(1);

    const chamadaCusto = chamadasUpdate.find((c) => c.ia_usada !== undefined);
    expect(chamadaCusto).toBeDefined();
    expect(chamadaCusto?.ia_usada).toBe(true);
    expect(chamadaCusto?.ia_custo_usd).toBe(0.004);
  });
});
