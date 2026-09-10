import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mocka o módulo inteiro, no mesmo padrão de processar.test.ts: reconstrói
// chamada por chamada os encadeamentos reais do Supabase, para que um erro de
// encadeamento no código de produção quebre o teste em vez de passar calado.
vi.mock("./supabase", () => ({ getSupabase: vi.fn() }));

import { getSupabase } from "./supabase";
const { decidirAcao, dentroDaJanela, ativarLead } = await import("./ativacao");

const DIA = { horarioInicio: "08:00", horarioFim: "20:00" };
const base = { modo: "real" as const, suprimir: false, motivo: null, ...DIA };

describe("dentroDaJanela", () => {
  it("aceita horário no meio da janela", () => {
    expect(dentroDaJanela(new Date("2026-09-10T13:00:00-03:00"), DIA)).toBe(true);
  });

  it("recusa antes da abertura", () => {
    expect(dentroDaJanela(new Date("2026-09-10T07:59:00-03:00"), DIA)).toBe(false);
  });

  it("recusa depois do fechamento", () => {
    expect(dentroDaJanela(new Date("2026-09-10T20:01:00-03:00"), DIA)).toBe(false);
  });

  it("aceita exatamente na abertura e recusa exatamente no fechamento", () => {
    expect(dentroDaJanela(new Date("2026-09-10T08:00:00-03:00"), DIA)).toBe(true);
    expect(dentroDaJanela(new Date("2026-09-10T20:00:00-03:00"), DIA)).toBe(false);
  });

  it("usa o fuso de São Paulo, não o do servidor", () => {
    // 23h UTC é 20h em SP: fora da janela. Se o servidor rodar em UTC e a
    // função ler a hora local, isso passaria e mandaria mensagem de madrugada.
    expect(dentroDaJanela(new Date("2026-09-10T23:00:00Z"), DIA)).toBe(false);
    expect(dentroDaJanela(new Date("2026-09-10T15:00:00Z"), DIA)).toBe(true);
  });

  it("aceita exatamente na abertura e recusa exatamente no fechamento quando o banco devolve HH:MM:SS", () => {
    // horario_inicio/horario_fim são `time` no Postgres: o PostgREST devolve
    // "08:00:00", não "08:00". Sem truncar para HH:MM antes de comparar, as
    // duas bordas se invertem: "08:00" >= "08:00:00" é false (recusaria a
    // abertura) e "20:00" < "20:00:00" é true (aceitaria o fechamento).
    const DIA_BANCO = { horarioInicio: "08:00:00", horarioFim: "20:00:00" };
    expect(dentroDaJanela(new Date("2026-09-10T08:00:00-03:00"), DIA_BANCO)).toBe(true);
    expect(dentroDaJanela(new Date("2026-09-10T20:00:00-03:00"), DIA_BANCO)).toBe(false);
  });

  it("mantém o mesmo resultado no formato de 5 e de 8 caracteres para o mesmo instante", () => {
    const DIA_BANCO = { horarioInicio: "08:00:00", horarioFim: "20:00:00" };
    for (const iso of [
      "2026-09-10T07:59:00-03:00",
      "2026-09-10T08:00:00-03:00",
      "2026-09-10T13:00:00-03:00",
      "2026-09-10T19:59:00-03:00",
      "2026-09-10T20:00:00-03:00",
      "2026-09-10T20:01:00-03:00",
    ]) {
      const data = new Date(iso);
      expect(dentroDaJanela(data, DIA_BANCO)).toBe(dentroDaJanela(data, DIA));
    }
  });
});

describe("decidirAcao", () => {
  beforeEach(() => fetchMock.mockReset());

  it("em dry_run monta o payload e NAO chama a rede", () => {
    const r = decidirAcao({ ...base, modo: "dry_run" });
    expect(r).toBe("dry_run");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suprimido vence o modo real", () => {
    expect(decidirAcao({ ...base, suprimir: true, motivo: "janela" })).toBe("suprimido");
  });

  it("suprimido vence o dry_run também", () => {
    expect(decidirAcao({ ...base, modo: "dry_run", suprimir: true, motivo: "kill-switch ligado" })).toBe("suprimido");
  });

  it("só libera envio quando o modo é real, sem supressão e dentro da janela", () => {
    expect(decidirAcao({ ...base, agora: new Date("2026-09-10T13:00:00-03:00") })).toBe("enviar");
  });

  it("adia quando está fora da janela, mesmo em modo real", () => {
    expect(decidirAcao({ ...base, agora: new Date("2026-09-10T03:00:00-03:00") })).toBe("adiar");
  });

  it("não adia em dry_run: fora da janela ainda registra o que mandaria", () => {
    expect(decidirAcao({ ...base, modo: "dry_run", agora: new Date("2026-09-10T03:00:00-03:00") })).toBe("dry_run");
  });

  it("trata modo desconhecido como dry_run, nunca como real", () => {
    expect(decidirAcao({ ...base, modo: "qualquer-coisa" as never })).toBe("dry_run");
  });
});

const LEAD_BASE = {
  id: 1,
  cliente_slug: "malentachi",
  telefone_e164: "5515991280217",
  nome: "Fulano da Silva",
  veiculo_texto: "Civic 2020",
  portal: "webmotors",
};

const CFG_BASE = {
  cliente_slug: "malentachi",
  texto_boas_vindas: "Oi {nome}, tudo bem? Vi seu interesse no {veiculo}.",
  // Não usar "" aqui: é o valor que expõe o bug do remetente vazio (ver
  // suíte "wts_from ausente/vazio" abaixo). Um wts_from de verdade na config
  // base é o que garante que os testes "de caminho feliz" exercitam o
  // caminho feliz de fato.
  wts_from: "5515991280217",
  janela_supressao_dias: 30,
  horario_inicio: "08:00:00",
  horario_fim: "20:00:00",
  modo_envio: "dry_run",
  kill_switch: false,
};

interface EstadoAtivacao {
  lead?: Record<string, unknown> | null;
  cfg?: Record<string, unknown>;
  anteriores?: { enviado_em: string | null }[];
  insertAtivacaoResultado?: { data: { id: number }[] | null; error: unknown };
  updateLeadResultado?: { data: { id: number }[] | null; error: unknown };
  updateAtivacaoResultado?: { data: { id: number }[] | null; error: unknown };
}

/**
 * Reconstrói, chamada por chamada, os encadeamentos reais que ativarLead faz
 * no Supabase — não um proxy genérico — para que um erro de encadeamento no
 * código de produção quebre o teste em vez de passar calado. Mesmo padrão de
 * processar.test.ts.
 */
function construirFrom(estado: EstadoAtivacao) {
  const chamadasInsertAtivacao: Record<string, unknown>[] = [];
  const chamadasUpdateAtivacao: Record<string, unknown>[] = [];
  const chamadasUpdateLead: Record<string, unknown>[] = [];
  // Ordem observável dos dois updates do ramo "enviar": precisa ser
  // ["lead", "ativacao"], nunca o contrário — é o que a correção garante.
  const ordemUpdates: string[] = [];
  let chamadasSelectAnteriores = 0;

  const lead = estado.lead ?? LEAD_BASE;
  const cfg = estado.cfg ?? CFG_BASE;
  const insertAtivacaoResultado = estado.insertAtivacaoResultado ?? { data: [{ id: 501 }], error: null };
  const updateLeadResultado = estado.updateLeadResultado ?? { data: [{ id: 1 }], error: null };
  const updateAtivacaoResultado = estado.updateAtivacaoResultado ?? { data: [{ id: 501 }], error: null };

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
          // cols === "enviado_em": busca do último contato com este telefone.
          chamadasSelectAnteriores++;
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
          ordemUpdates.push("lead");
          return { eq: vi.fn(() => ({ select: vi.fn(async () => updateLeadResultado) })) };
        }),
      };
    }
    if (tabela === "portais_config") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: cfg, error: null })),
          })),
        })),
      };
    }
    if (tabela === "portais_ativacoes") {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          chamadasInsertAtivacao.push(payload);
          return { select: vi.fn(async () => insertAtivacaoResultado) };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          chamadasUpdateAtivacao.push(payload);
          ordemUpdates.push("ativacao");
          return { eq: vi.fn(() => ({ select: vi.fn(async () => updateAtivacaoResultado) })) };
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
    ordemUpdates,
    get chamadasSelectAnteriores() {
      return chamadasSelectAnteriores;
    },
  };
}

function mockarSupabase(estado: EstadoAtivacao = {}) {
  const construido = construirFrom(estado);
  vi.mocked(getSupabase).mockReturnValue({ from: construido.from } as never);
  return construido;
}

describe("ativarLead", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getSupabase).mockReset();
    process.env.WTS_TOKEN = "token-de-teste";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.WTS_TOKEN;
  });

  // O teste mais importante do sistema: em dry_run, a rede nunca é tocada.
  it("modo dry_run: fetch NUNCA é chamado", async () => {
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const acao = await ativarLead(1);

    expect(acao).toBe("dry_run");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("modo dry_run: grava a linha em portais_ativacoes mesmo assim, com payload_enviado preenchido", async () => {
    const { chamadasInsertAtivacao } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    await ativarLead(1);

    expect(chamadasInsertAtivacao).toHaveLength(1);
    expect(chamadasInsertAtivacao[0].modo).toBe("dry_run");
    const payload = chamadasInsertAtivacao[0].payload_enviado as { body: { text: string } } | null;
    expect(payload).toBeTruthy();
    expect(payload?.body.text).toContain("Fulano");
  });

  it("lead suprimido: fetch não é chamado, e motivo_supressao é gravado no lead", async () => {
    const { chamadasUpdateLead } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real", kill_switch: true } });

    const acao = await ativarLead(1);

    expect(acao).toBe("suprimido");
    expect(fetchMock).not.toHaveBeenCalled();
    const chamada = chamadasUpdateLead.find((c) => c.status_ativacao === "suprimido");
    expect(chamada).toBeDefined();
    expect(chamada?.motivo_supressao).toBe("kill-switch ligado");
  });

  it("modo real fora da janela de horário: fetch não é chamado (decisão adiar)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T03:00:00-03:00")); // 3h da manhã, fora de 08h-20h
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    const acao = await ativarLead(1);

    expect(acao).toBe("adiar");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("modo real, sem supressão, dentro da janela: fetch É chamado e o lead vai para status enviado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00")); // dentro de 08h-20h
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "msg-1" }) });
    const { chamadasUpdateLead } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    const acao = await ativarLead(1);

    expect(acao).toBe("enviar");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const chamada = chamadasUpdateLead.find((c) => c.status_ativacao === "enviado");
    expect(chamada).toBeDefined();
  });

  // PostgREST devolve 200 com lista vazia quando o insert não gravou. Sem
  // conferir a linha de volta, a ausência de auditoria passaria em silêncio —
  // exatamente o oposto do propósito desta tabela.
  it("insert em portais_ativacoes que não devolve linha faz a função estourar", async () => {
    mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "dry_run" },
      insertAtivacaoResultado: { data: [], error: null },
    });

    await expect(ativarLead(1)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // O normalizador de telefone devolve null de propósito quando o número é
  // ambíguo (ver telefone.ts). Sem esta guarda, decidirAcao nunca vê o
  // telefone ausente e libera "enviar" — wtsRequest faria JSON.stringify(null)
  // e postaria a string "null" pro WTS.
  it("lead sem telefone_e164, em modo real e dentro da janela: fetch NUNCA é chamado, motivo fica gravado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00")); // dentro de 08h-20h
    const { chamadasUpdateLead, chamadasInsertAtivacao } = mockarSupabase({
      lead: { ...LEAD_BASE, telefone_e164: null },
      cfg: { ...CFG_BASE, modo_envio: "real" },
    });

    const acao = await ativarLead(1);

    expect(acao).toBe("suprimido");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chamadasInsertAtivacao[0].erro).toBe("sem telefone normalizavel");
    const chamada = chamadasUpdateLead.find((c) => c.status_ativacao === "suprimido");
    expect(chamada).toBeDefined();
    expect(chamada?.motivo_supressao).toBe("sem telefone normalizavel");
  });

  // A checagem de telefone ausente precisa vir ANTES da busca de supressão:
  // `.eq("telefone_e164", null)` não casa com nada em SQL, então emitir essa
  // consulta pra um lead sem telefone é só ruído (e mascararia a real razão).
  it("lead sem telefone_e164: não emite a consulta de supressão por reincidência", async () => {
    const { chamadasSelectAnteriores } = mockarSupabase({
      lead: { ...LEAD_BASE, telefone_e164: null },
      cfg: { ...CFG_BASE, modo_envio: "real" },
    });

    await ativarLead(1);

    expect(chamadasSelectAnteriores).toBe(0);
  });

  // Mesma cicatriz do insert em portais_ativacoes, agora nos dois updates de
  // portais_leads: PostgREST devolve 200 com lista vazia quando o "id" não
  // existe. Sem conferir a linha de volta, um lead apagado/renumerado entre a
  // leitura e a gravação passaria por "suprimido com sucesso" sem ter gravado nada.
  it("update em portais_leads (caminho suprimido/dry_run) que não devolve linha faz a função estourar", async () => {
    mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "dry_run" },
      updateLeadResultado: { data: [], error: null },
    });

    await expect(ativarLead(1)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mesmo cenário, agora no update final do caminho "enviar" (status
  // enviado/enviado_em). Como este roda DEPOIS do fetch, a mensagem já saiu —
  // por isso o teste também confere que o fetch foi mesmo chamado.
  it("update em portais_leads (caminho enviar) que não devolve linha faz a função estourar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00")); // dentro de 08h-20h
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "msg-1" }) });
    mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "real" },
      updateLeadResultado: { data: [], error: null },
    });

    await expect(ativarLead(1)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // O estado do lead (status_ativacao/enviado_em) é o que sustenta a
  // supressão por reincidência; resposta_wts é só auditoria auxiliar. Uma
  // falha em gravar resposta_wts não pode abortar a função depois que o
  // estado crítico já foi gravado — do contrário o lead nunca fica marcado
  // como "enviado" e a próxima rodada manda a mesma mensagem de novo.
  it("update de resposta_wts em portais_ativacoes que não devolve linha NÃO aborta: lead fica marcado como enviado e a exceção não propaga", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00")); // dentro de 08h-20h
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "msg-1" }) });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { chamadasUpdateLead } = mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "real" },
      updateAtivacaoResultado: { data: [], error: null },
    });

    const acao = await ativarLead(1);

    expect(acao).toBe("enviar");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const chamada = chamadasUpdateLead.find((c) => c.status_ativacao === "enviado");
    expect(chamada).toBeDefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  // Ordem importa: se a gravação do estado do lead rodasse depois da
  // auditoria (ordem antiga), uma falha na auditoria bloquearia justamente a
  // gravação da qual a supressão depende. Confere a ordem observável nos
  // mocks, não só o resultado final.
  it("grava o estado do lead (enviado) ANTES do registro de auditoria (resposta_wts)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00")); // dentro de 08h-20h
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "msg-1" }) });
    const { ordemUpdates } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    await ativarLead(1);

    expect(ordemUpdates).toEqual(["lead", "ativacao"]);
  });

  // O bug original: `from: cfg.wts_from ?? ""` só cobre null/undefined. Uma
  // config com wts_from = "" (o próprio default de CFG_BASE antes deste
  // teste existir) chegava ao payload sem remetente e sem nenhuma guarda —
  // e passava despercebida porque a suíte inteira usava esse mesmo valor.
  it.each([["vazia", ""], ["só espaço", "   "], ["null", null], ["ausente", undefined]])(
    "wts_from %s: suprimido com motivo explícito, fetch NUNCA é chamado, motivo fica gravado",
    async (_rotulo, valor) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00")); // dentro de 08h-20h
      const { chamadasUpdateLead, chamadasInsertAtivacao } = mockarSupabase({
        cfg: { ...CFG_BASE, modo_envio: "real", wts_from: valor },
      });

      const acao = await ativarLead(1);

      expect(acao).toBe("suprimido");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(chamadasInsertAtivacao[0].erro).toBe("remetente nao configurado");
      const chamada = chamadasUpdateLead.find((c) => c.status_ativacao === "suprimido");
      expect(chamada).toBeDefined();
      expect(chamada?.motivo_supressao).toBe("remetente nao configurado");
    },
  );

  // Mesma classe de bug do wts_from, no vizinho: um template só de
  // placeholders que a IA não preencheu monta uma string vazia, e isso só
  // se sabe depois da substituição — por isso a guarda mede o resultado de
  // montarTexto, não o texto_boas_vindas cru.
  it("texto de boas-vindas vazio após montagem: suprimido, fetch NUNCA é chamado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00")); // dentro de 08h-20h
    const { chamadasUpdateLead, chamadasInsertAtivacao } = mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "real", texto_boas_vindas: "   " },
    });

    const acao = await ativarLead(1);

    expect(acao).toBe("suprimido");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chamadasInsertAtivacao[0].erro).toBe("texto de boas-vindas vazio");
    const chamada = chamadasUpdateLead.find((c) => c.status_ativacao === "suprimido");
    expect(chamada).toBeDefined();
    expect(chamada?.motivo_supressao).toBe("texto de boas-vindas vazio");
  });
});
