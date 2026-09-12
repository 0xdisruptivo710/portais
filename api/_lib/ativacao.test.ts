import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mocka o módulo inteiro, no mesmo padrão de processar.test.ts: reconstrói
// chamada por chamada os encadeamentos reais do Supabase, para que um erro de
// encadeamento no código de produção quebre o teste em vez de passar calado.
vi.mock("./supabase", () => ({ getSupabase: vi.fn() }));

import { getSupabase } from "./supabase";
const { decidirAcao, dentroDaJanela, ativarLead, ativarLeadDetalhado, previaDeEnvio } = await import("./ativacao");

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

  // O botão do painel autoriza ESTE lead, sem mexer na config. Sem isso, o
  // clique do operador cairia em dry_run e nada sairia — com a tela dizendo
  // que deu certo.
  it("autorizacao manual envia com a config ainda em dry_run", () => {
    expect(
      decidirAcao({
        ...base,
        modo: "dry_run",
        autorizadoManualmente: true,
        agora: new Date("2026-09-10T13:00:00-03:00"),
      }),
    ).toBe("enviar");
  });

  // Decisão explícita: o humano olhando para o lead é uma guarda mais forte
  // que o relógio, e "adiar" não tem quem repesque no caminho manual.
  it("autorizacao manual dispensa a janela de horario, em vez de adiar", () => {
    expect(
      decidirAcao({
        ...base,
        modo: "dry_run",
        autorizadoManualmente: true,
        agora: new Date("2026-09-10T21:30:00-03:00"),
      }),
    ).toBe("enviar");
  });

  // A supressão é a única guarda que o botão NÃO pode contornar.
  it("supressao vence a autorizacao manual", () => {
    expect(
      decidirAcao({ ...base, suprimir: true, motivo: "kill-switch ligado", autorizadoManualmente: true }),
    ).toBe("suprimido");
  });
});

const LEAD_BASE = {
  id: 1,
  cliente_slug: "malentachi",
  telefone_e164: "5515991280217",
  telefone_exibicao: "+55 (15) 99128-0217",
  nome: "Fulano da Silva",
  veiculo_texto: "Civic 2020",
  portal: "webmotors",
  // Espelha a realidade: só chega em ativarLead quem ativarPendentes (fila.ts)
  // selecionou com status_ativacao = 'pendente'.
  status_ativacao: "pendente",
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
  // O botão de envio manual não pode mexer na config do cliente: qualquer
  // escrita em portais_config aparece aqui e derruba o teste.
  const chamadasUpdateConfig: Record<string, unknown>[] = [];
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
    chamadasUpdateConfig,
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

  it("modo real fora da janela de horário: fetch não é chamado e o lead permanece pendente (decisão adiar)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T03:00:00-03:00")); // 3h da manhã, fora de 08h-20h
    const { chamadasUpdateLead } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    const acao = await ativarLead(1);

    expect(acao).toBe("adiar");
    expect(fetchMock).not.toHaveBeenCalled();
    // O lead tem que permanecer "pendente" (nenhuma escrita em portais_leads
    // aqui), senão ativarPendentes (que só seleciona status_ativacao =
    // 'pendente') nunca mais repesca este id e o lead some da fila até 08h.
    expect(chamadasUpdateLead).toHaveLength(0);
  });

  it("modo real, sem supressão, dentro da janela: fetch É chamado e o lead vai para status enviado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00")); // dentro de 08h-20h
    fetchMock.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ id: "msg-1" }) });
    const { chamadasUpdateLead } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    const acao = await ativarLead(1);

    expect(acao).toBe("enviar");
    // Por rota, não sobre o fetchMock inteiro: a conferência de conversa
    // aberta que roda antes do envio também é uma chamada, e o que este teste
    // afirma é "um envio", não "uma requisição".
    expect(chamadasDeEnvio()).toHaveLength(1);
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
    expect(chamadasDeEnvio()).toHaveLength(1);
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
    expect(chamadasDeEnvio()).toHaveLength(1);
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

const CONTATO_WTS = "contato-1";

/**
 * Roteia o mock de fetch por URL: a conferência de conversa aberta, o envio e
 * a conferência de status são chamadas diferentes na mesma função, e
 * contá-las juntas esconderia justamente o que importa aqui (um envio, nunca
 * dois). Por isso todas as contagens abaixo são por rota, nunca sobre o
 * fetchMock inteiro.
 */
function mockarFetchWts(statusDaMensagem: unknown = { status: "DELIVERED" }, sessoes: unknown[] = []) {
  fetchMock.mockImplementation(async (url: unknown) => {
    const alvo = String(url);
    if (alvo.includes("/core/v1/contact/phonenumber/")) {
      return { ok: true, text: async () => JSON.stringify({ id: CONTATO_WTS }) };
    }
    if (alvo.includes("/chat/v2/session")) {
      return { ok: true, text: async () => JSON.stringify({ items: sessoes }) };
    }
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

function chamadasDeStatus(): unknown[] {
  return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/status"));
}

function chamadasDeSessao(): unknown[] {
  return fetchMock.mock.calls.filter((c) => String(c[0]).includes("/chat/v2/session"));
}

/** Uma sessão do contato com mensagem no instante pedido. */
function sessao(quando: string) {
  return { contactId: CONTATO_WTS, lastMessageIn: quando, status: "OPEN" };
}

const MANUAL = { autorizadoManualmente: true };

describe("ativarLeadDetalhado com autorizacao manual (botao do painel)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getSupabase).mockReset();
    process.env.WTS_TOKEN = "token-de-teste";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.WTS_TOKEN;
  });

  it("envia com a config ainda em dry_run, e NAO escreve em portais_config", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts();
    const { chamadasUpdateLead, chamadasUpdateConfig } = mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "dry_run" },
    });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("enviar");
    expect(chamadasDeEnvio()).toHaveLength(1);
    expect(chamadasUpdateLead.find((c) => c.status_ativacao === "enviado")).toBeDefined();
    // O botão é autorização de um envio, não uma troca de configuração.
    expect(chamadasUpdateConfig).toHaveLength(0);
  });

  it("grava enviado_em no lead e a resposta do WTS na linha de auditoria", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts();
    const { chamadasUpdateLead, chamadasUpdateAtivacao } = mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "dry_run" },
    });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    const gravacaoLead = chamadasUpdateLead.find((c) => c.status_ativacao === "enviado");
    expect(gravacaoLead?.enviado_em).toBe(new Date("2026-09-10T13:00:00-03:00").toISOString());
    expect(chamadasUpdateAtivacao).toHaveLength(1);
    expect(chamadasUpdateAtivacao[0].resposta_wts).toEqual({ id: "msg-1", status: "QUEUED" });
    expect(resultado.respostaWts).toEqual({ id: "msg-1", status: "QUEUED" });
  });

  // Decisão do botão: a autorização humana dispensa a janela de horário. O
  // preço disso é o registro ter que dizer, sem ambiguidade, que foi envio
  // manual fora do horário combinado.
  it("fora da janela de horario ainda envia, e a auditoria registra modo manual_fora_janela", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T21:30:00-03:00"));
    mockarFetchWts();
    const { chamadasInsertAtivacao } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("enviar");
    expect(chamadasDeEnvio()).toHaveLength(1);
    expect(chamadasInsertAtivacao[0].modo).toBe("manual_fora_janela");
  });

  it("dentro da janela a auditoria registra modo manual", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts();
    const { chamadasInsertAtivacao } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    await ativarLeadDetalhado(1, MANUAL);

    expect(chamadasInsertAtivacao[0].modo).toBe("manual");
  });

  it("kill-switch ligado: suprimido com motivo, a rede NUNCA e tocada", async () => {
    const { chamadasUpdateLead } = mockarSupabase({ cfg: { ...CFG_BASE, kill_switch: true } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("suprimido");
    expect(resultado.motivo).toBe("kill-switch ligado");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(chamadasUpdateLead.find((c) => c.status_ativacao === "suprimido")).toBeDefined();
  });

  it("lead sem telefone: suprimido com motivo, a rede NUNCA e tocada", async () => {
    mockarSupabase({ lead: { ...LEAD_BASE, telefone_e164: null, telefone_exibicao: null } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("suprimido");
    expect(resultado.motivo).toBe("sem telefone normalizavel");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("telefone contatado dentro da janela de supressao: suprimido, a rede NUNCA e tocada", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarSupabase({ anteriores: [{ enviado_em: "2026-09-07T13:00:00-03:00" }] });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("suprimido");
    expect(resultado.motivo).toBe("contatado ha 3d, janela de 30d");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confere a entrega uma vez e grava verificado/verificacao_detalhe", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts({ status: "DELIVERED" });
    const { chamadasUpdateAtivacao } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(chamadasDeStatus()).toHaveLength(1);
    expect(resultado.verificado).toBe(true);
    expect(chamadasUpdateAtivacao[0].verificado).toBe(true);
    expect(String(chamadasUpdateAtivacao[0].verificacao_detalhe)).toContain("DELIVERED");
  });

  // A cicatriz conhecida: o WTS responde QUEUED em mensagem que nunca chega.
  // QUEUED não pode virar "entregue" em lugar nenhum do sistema.
  it("status QUEUED na conferencia NAO vira entrega confirmada", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts({ status: "QUEUED" });
    const { chamadasUpdateAtivacao } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("enviar");
    expect(resultado.verificado).toBe(false);
    expect(chamadasUpdateAtivacao[0].verificado).toBe(false);
    expect(String(chamadasUpdateAtivacao[0].verificacao_detalhe)).toContain("QUEUED");
  });

  it("falha na conferencia nao derruba o envio: verificado fica false com o motivo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    fetchMock.mockImplementation(async (url: unknown) => {
      const alvo = String(url);
      // A conferência de conversa aberta responde normal: o que falha aqui é
      // só a consulta de status, que é o que este teste mede.
      if (alvo.includes("/core/v1/contact/phonenumber/")) {
        return { ok: true, text: async () => JSON.stringify({ id: CONTATO_WTS }) };
      }
      if (alvo.includes("/chat/v2/session")) {
        return { ok: true, text: async () => JSON.stringify({ items: [] }) };
      }
      if (alvo.endsWith("/chat/v1/message/send")) {
        return { ok: true, text: async () => JSON.stringify({ id: "msg-1" }) };
      }
      return { ok: false, status: 404, text: async () => "nao encontrada" };
    });
    const { chamadasUpdateLead } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("enviar");
    expect(resultado.verificado).toBe(false);
    expect(resultado.verificacaoDetalhe).toContain("404");
    expect(chamadasUpdateLead.find((c) => c.status_ativacao === "enviado")).toBeDefined();
  });

  it("resposta de envio sem id: registra honestamente que nao deu para conferir", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    fetchMock.mockImplementation(async (url: unknown) => {
      const alvo = String(url);
      if (alvo.includes("/core/v1/contact/phonenumber/")) {
        return { ok: true, text: async () => JSON.stringify({ id: CONTATO_WTS }) };
      }
      if (alvo.includes("/chat/v2/session")) {
        return { ok: true, text: async () => JSON.stringify({ items: [] }) };
      }
      // O que este teste mede: a resposta do ENVIO sem id de mensagem.
      return { ok: true, text: async () => JSON.stringify({ status: "QUEUED" }) };
    });
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(chamadasDeStatus()).toHaveLength(0);
    expect(resultado.verificado).toBe(false);
    expect(resultado.verificacaoDetalhe).toContain("id");
  });

  // O caminho do cron continua com uma chamada de rede só. Conferir status em
  // lote é outra decisão (custo por lead dentro dos 300s da function), e o
  // registro não pode mentir dizendo que conferiu.
  it("envio automatico em modo real nao consulta status e registra que nao conferiu", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarFetchWts();
    const { chamadasUpdateAtivacao } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    await ativarLead(1);

    expect(chamadasDeEnvio()).toHaveLength(1);
    expect(chamadasDeStatus()).toHaveLength(0);
    expect(chamadasUpdateAtivacao[0].verificado).toBe(false);
    expect(String(chamadasUpdateAtivacao[0].verificacao_detalhe)).toContain("automatico");
  });
});

/**
 * A guarda que faltava. O telefone do lead pode já estar no meio de uma
 * negociação com a equipe humana, e `portais_leads.enviado_em` não sabe disso:
 * ele só conhece os contatos que ESTE app fez. Aconteceu em produção, com
 * cliente real, e a mensagem foi apagada nove segundos depois.
 */
describe("supressao por conversa aberta no WTS", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getSupabase).mockReset();
    process.env.WTS_TOKEN = "token-de-teste";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.WTS_TOKEN;
  });

  it("telefone com conversa recente: suprimido, e a rede de ENVIO nao e chamada", async () => {
    mockarFetchWts({ status: "DELIVERED" }, [sessao("2026-09-10T11:00:00-03:00")]);
    const { chamadasUpdateLead, chamadasInsertAtivacao } = mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "real" },
    });

    const resultado = await ativarLeadDetalhado(1);

    expect(resultado.acao).toBe("suprimido");
    expect(chamadasDeEnvio()).toHaveLength(0);
    expect(resultado.motivo).toBe("ja existe conversa no WTS, ultima mensagem ha 2h");
    expect(chamadasInsertAtivacao[0].erro).toBe("ja existe conversa no WTS, ultima mensagem ha 2h");
    const gravacao = chamadasUpdateLead.find((c) => c.status_ativacao === "suprimido");
    expect(gravacao?.motivo_supressao).toBe("ja existe conversa no WTS, ultima mensagem ha 2h");
  });

  it("telefone sem conversa nenhuma: envia normalmente", async () => {
    mockarFetchWts({ status: "DELIVERED" }, []);
    const { chamadasUpdateLead } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    const resultado = await ativarLeadDetalhado(1);

    expect(resultado.acao).toBe("enviar");
    expect(chamadasDeEnvio()).toHaveLength(1);
    expect(chamadasUpdateLead.find((c) => c.status_ativacao === "enviado")).toBeDefined();
  });

  // Lead que volta meses depois por outro portal continua sendo lead.
  it("conversa antiga, fora do criterio de recencia: envia", async () => {
    mockarFetchWts({ status: "DELIVERED" }, [sessao("2026-05-10T11:00:00-03:00")]);
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    const resultado = await ativarLeadDetalhado(1);

    expect(resultado.acao).toBe("enviar");
    expect(chamadasDeEnvio()).toHaveLength(1);
  });

  it("usa janela_conversa_dias da config quando ela existe", async () => {
    // 2 dias atrás: dentro de uma janela de 30, fora da janela padrão de 7.
    mockarFetchWts({ status: "DELIVERED" }, [sessao("2026-09-08T11:00:00-03:00")]);
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real", janela_conversa_dias: 1 } });

    const resultado = await ativarLeadDetalhado(1);

    expect(resultado.acao).toBe("enviar");
  });

  // Fail-closed, e no caminho automático o preço é "adiar", não "suprimir":
  // o lead PERMANECE pendente e a próxima passada do cron tenta de novo. Uma
  // instabilidade do WTS não pode apagar um lead legítimo da fila em silêncio.
  it("falha na consulta, caminho automatico: adia, lead continua pendente, nada e enviado", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/core/v1/contact/phonenumber/")) {
        return { ok: true, text: async () => JSON.stringify({ id: CONTATO_WTS }) };
      }
      return { ok: false, status: 503, text: async () => "indisponivel" };
    });
    const { chamadasUpdateLead, chamadasInsertAtivacao } = mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "real" },
    });

    const resultado = await ativarLeadDetalhado(1);

    expect(resultado.acao).toBe("adiar");
    expect(chamadasDeEnvio()).toHaveLength(0);
    // Nenhuma escrita em portais_leads: é isso que devolve o lead à fila.
    expect(chamadasUpdateLead).toHaveLength(0);
    expect(String(chamadasInsertAtivacao[0].erro)).toContain("nao foi possivel conferir conversa no WTS");
  });

  it("falha na consulta, caminho manual: suprimido com o motivo, e nao da para forcar", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/core/v1/contact/phonenumber/")) {
        return { ok: true, text: async () => JSON.stringify({ id: CONTATO_WTS }) };
      }
      return { ok: false, status: 503, text: async () => "indisponivel" };
    });
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("suprimido");
    expect(chamadasDeEnvio()).toHaveLength(0);
    expect(String(resultado.motivo)).toContain("nao foi possivel conferir");
    // Dá para decidir por cima de uma informação, nunca por cima de uma
    // ignorância: sem saber se existe negociação, o botão não oferece saída.
    expect(resultado.podeForcar).toBe(false);
  });

  it("conversa recente no caminho manual: suprimido, e a tela recebe podeForcar", async () => {
    mockarFetchWts({ status: "DELIVERED" }, [sessao("2026-09-10T11:00:00-03:00")]);
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("suprimido");
    expect(resultado.podeForcar).toBe(true);
    expect(chamadasDeEnvio()).toHaveLength(0);
  });

  it("forcar com conversa recente envia, e a auditoria diz manual_conversa_aberta", async () => {
    mockarFetchWts({ status: "DELIVERED" }, [sessao("2026-09-10T11:00:00-03:00")]);
    const { chamadasInsertAtivacao } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const resultado = await ativarLeadDetalhado(1, { ...MANUAL, ignorarConversaAberta: true });

    expect(resultado.acao).toBe("enviar");
    expect(chamadasDeEnvio()).toHaveLength(1);
    expect(chamadasInsertAtivacao[0].modo).toBe("manual_conversa_aberta");
  });

  it("forcar fora da janela de horario registra as duas coisas no modo", async () => {
    vi.setSystemTime(new Date("2026-09-10T21:30:00-03:00"));
    mockarFetchWts({ status: "DELIVERED" }, [sessao("2026-09-10T20:00:00-03:00")]);
    const { chamadasInsertAtivacao } = mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    await ativarLeadDetalhado(1, { ...MANUAL, ignorarConversaAberta: true });

    expect(chamadasInsertAtivacao[0].modo).toBe("manual_conversa_aberta_fora_janela");
  });

  // Forçar levanta UMA guarda, a de conversa aberta. Nenhuma outra.
  it("forcar nao contorna o kill-switch", async () => {
    mockarFetchWts({ status: "DELIVERED" }, [sessao("2026-09-10T11:00:00-03:00")]);
    mockarSupabase({ cfg: { ...CFG_BASE, kill_switch: true } });

    const resultado = await ativarLeadDetalhado(1, { ...MANUAL, ignorarConversaAberta: true });

    expect(resultado.acao).toBe("suprimido");
    expect(resultado.motivo).toBe("kill-switch ligado");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forcar no caminho automatico nao existe: a opcao so vale com autorizacao manual", async () => {
    mockarFetchWts({ status: "DELIVERED" }, [sessao("2026-09-10T11:00:00-03:00")]);
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    const resultado = await ativarLeadDetalhado(1, { ignorarConversaAberta: true });

    expect(resultado.acao).toBe("suprimido");
    expect(chamadasDeEnvio()).toHaveLength(0);
  });

  // A consulta só acontece quando uma mensagem está mesmo prestes a sair. Em
  // dry_run nada sai, e a promessa de que dry_run não toca a rede continua de pé.
  it("dry_run nao consulta conversa nenhuma", async () => {
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "dry_run" } });

    const acao = await ativarLead(1);

    expect(acao).toBe("dry_run");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fora da janela de horario nao consulta conversa: o lead nem chegou a enviar", async () => {
    vi.setSystemTime(new Date("2026-09-10T03:00:00-03:00"));
    mockarSupabase({ cfg: { ...CFG_BASE, modo_envio: "real" } });

    const acao = await ativarLead(1);

    expect(acao).toBe("adiar");
    expect(chamadasDeSessao()).toHaveLength(0);
  });

  it("ja suprimido por outra guarda nao gasta consulta ao WTS", async () => {
    mockarSupabase({
      cfg: { ...CFG_BASE, modo_envio: "real" },
      anteriores: [{ enviado_em: "2026-09-07T13:00:00-03:00" }],
    });

    const resultado = await ativarLeadDetalhado(1, MANUAL);

    expect(resultado.acao).toBe("suprimido");
    expect(resultado.motivo).toBe("contatado ha 3d, janela de 30d");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("previaDeEnvio", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getSupabase).mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("devolve o texto montado e o destino, sem tocar a rede", async () => {
    mockarSupabase();

    const previa = await previaDeEnvio(1);

    expect(previa.texto).toContain("Fulano");
    expect(previa.texto).toContain("Civic 2020");
    expect(previa.telefoneExibicao).toBe("+55 (15) 99128-0217");
    expect(previa.para).toBe("+55|15991280217");
    expect(previa.bloqueado).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("avisa que o telefone ja recebeu mensagem, com ha quantos dias", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarSupabase({ anteriores: [{ enviado_em: "2026-09-07T13:00:00-03:00" }] });

    const previa = await previaDeEnvio(1);

    expect(previa.diasDesdeUltimoContato).toBe(3);
    expect(previa.ultimoContatoEm).toBe(new Date("2026-09-07T13:00:00-03:00").toISOString());
  });

  // O aviso de reincidência tem que aparecer mesmo quando a janela de
  // supressão já passou: o envio é liberado, mas a pessoa já foi abordada.
  it("mostra o contato anterior mesmo fora da janela de supressao, sem bloquear", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-10T13:00:00-03:00"));
    mockarSupabase({ anteriores: [{ enviado_em: "2026-07-01T13:00:00-03:00" }] });

    const previa = await previaDeEnvio(1);

    expect(previa.bloqueado).toBe(false);
    expect(previa.diasDesdeUltimoContato).toBe(71);
  });

  it("lead sem telefone: bloqueado com o motivo, e sem destino", async () => {
    mockarSupabase({ lead: { ...LEAD_BASE, telefone_e164: null, telefone_exibicao: null } });

    const previa = await previaDeEnvio(1);

    expect(previa.bloqueado).toBe(true);
    expect(previa.motivo).toBe("sem telefone normalizavel");
    expect(previa.para).toBeNull();
  });
});
