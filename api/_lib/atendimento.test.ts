import { describe, expect, it, vi } from "vitest";
import {
  atualizarAtendimento,
  estadoDeAtendimento,
  precisaConferir,
  TETO_CONSULTAS,
  TTL_CONFERENCIA_MS,
  type DepsAtendimento,
  type LeadParaAtendimento,
} from "./atendimento";

const AGORA = new Date("2026-09-14T15:00:00Z");
const JANELA = 7;

function lead(over: Partial<LeadParaAtendimento> = {}): LeadParaAtendimento {
  return {
    id: 1,
    telefone_e164: "5515991280217",
    conversa_ultima_mensagem_em: null,
    conversa_conferida_em: null,
    ...over,
  };
}

/**
 * A decisão é RECALCULADA a partir da data da última mensagem, nunca lida de
 * um booleano gravado. Isso é o que faz o dado envelhecer para o lado seguro:
 * com o tempo, um registro velho só pode PARAR de dizer "em atendimento", e
 * nunca começar a dizer. O contrário (a conversa que nasceu depois da última
 * conferência) é o caso que a reconferência por TTL resolve.
 */
describe("estadoDeAtendimento", () => {
  it("lead sem telefone nao tem essa pergunta: e' sem_telefone, nao sem_conversa", () => {
    // OLX, Mercado Livre e o aviso de chat nao trazem numero. Dizer
    // "sem conversa" para eles seria afirmar o que ninguem conferiu.
    expect(estadoDeAtendimento(lead({ telefone_e164: null }), { janelaDias: JANELA, agora: AGORA })).toBe(
      "sem_telefone",
    );
  });

  it("nunca conferido nao e' sem_conversa: e' nao_conferido", () => {
    expect(estadoDeAtendimento(lead(), { janelaDias: JANELA, agora: AGORA })).toBe("nao_conferido");
  });

  it("conferido e com mensagem recente e' em_atendimento", () => {
    const l = lead({
      conversa_conferida_em: "2026-09-14T14:50:00Z",
      conversa_ultima_mensagem_em: "2026-09-14T13:00:00Z",
    });
    expect(estadoDeAtendimento(l, { janelaDias: JANELA, agora: AGORA })).toBe("em_atendimento");
  });

  it("conferido e sem conversa nenhuma e' sem_conversa", () => {
    const l = lead({ conversa_conferida_em: "2026-09-14T14:50:00Z", conversa_ultima_mensagem_em: null });
    expect(estadoDeAtendimento(l, { janelaDias: JANELA, agora: AGORA })).toBe("sem_conversa");
  });

  it("conversa antiga deixa de contar sozinha, sem ninguem reconferir", () => {
    // Conferido em maio, com a ultima mensagem em maio: hoje isso nao e' mais
    // atendimento em andamento, e o registro velho nao pode fingir que e'.
    const l = lead({
      conversa_conferida_em: "2026-05-01T14:50:00Z",
      conversa_ultima_mensagem_em: "2026-05-01T13:00:00Z",
    });
    expect(estadoDeAtendimento(l, { janelaDias: JANELA, agora: AGORA })).toBe("sem_conversa");
  });

  it("aguenta coluna ausente no banco (migration que ainda nao rodou)", () => {
    const semColunas = { id: 9, telefone_e164: "5515991280217" };
    expect(estadoDeAtendimento(semColunas, { janelaDias: JANELA, agora: AGORA })).toBe("nao_conferido");
  });

  it("aguenta data invalida sem virar Invalid Date", () => {
    const l = lead({ conversa_conferida_em: "2026-09-14T14:50:00Z", conversa_ultima_mensagem_em: "nao e data" });
    expect(estadoDeAtendimento(l, { janelaDias: JANELA, agora: AGORA })).toBe("sem_conversa");
  });
});

describe("precisaConferir", () => {
  it("lead sem telefone nao gasta chamada de rede", () => {
    expect(precisaConferir(lead({ telefone_e164: null }), AGORA)).toBe(false);
  });

  it("nunca conferido precisa", () => {
    expect(precisaConferir(lead(), AGORA)).toBe(true);
  });

  it("conferido agora ha pouco nao precisa: o cache vale", () => {
    const l = lead({ conversa_conferida_em: new Date(AGORA.getTime() - 60_000).toISOString() });
    expect(precisaConferir(l, AGORA)).toBe(false);
  });

  it("conferido alem do TTL precisa de novo", () => {
    const l = lead({ conversa_conferida_em: new Date(AGORA.getTime() - TTL_CONFERENCIA_MS - 1).toISOString() });
    expect(precisaConferir(l, AGORA)).toBe(true);
  });
});

function deps(over: Partial<DepsAtendimento> = {}): DepsAtendimento {
  return {
    lerLeads: vi.fn(async () => [lead()]),
    consultar: vi.fn(async () => ({ ultimaMensagemEm: new Date("2026-09-14T13:00:00Z"), falhou: false, detalhe: null })),
    gravar: vi.fn(async () => {}),
    agora: () => AGORA,
    janelaDias: JANELA,
    ...over,
  };
}

describe("atualizarAtendimento", () => {
  it("consulta o WTS e grava a data da ultima mensagem", async () => {
    const d = deps();
    const r = await atualizarAtendimento([1], d);

    expect(d.consultar).toHaveBeenCalledWith("5515991280217");
    expect(d.gravar).toHaveBeenCalledWith(1, {
      conversa_ultima_mensagem_em: "2026-09-14T13:00:00.000Z",
      conversa_conferida_em: AGORA.toISOString(),
    });
    expect(r.itens).toEqual([
      {
        lead_id: 1,
        estado: "em_atendimento",
        ultima_mensagem_em: "2026-09-14T13:00:00.000Z",
        conferido_em: AGORA.toISOString(),
        detalhe: null,
      },
    ]);
    expect(r.consultados).toBe(1);
  });

  it("cache fresco nao gasta chamada nenhuma", async () => {
    const d = deps({
      lerLeads: vi.fn(async () => [
        lead({
          conversa_conferida_em: new Date(AGORA.getTime() - 60_000).toISOString(),
          conversa_ultima_mensagem_em: "2026-09-14T12:00:00Z",
        }),
      ]),
    });

    const r = await atualizarAtendimento([1], d);

    expect(d.consultar).not.toHaveBeenCalled();
    expect(r.consultados).toBe(0);
    expect(r.itens[0].estado).toBe("em_atendimento");
  });

  it("lead sem telefone nao gasta chamada e volta como sem_telefone", async () => {
    const d = deps({ lerLeads: vi.fn(async () => [lead({ telefone_e164: null })]) });

    const r = await atualizarAtendimento([1], d);

    expect(d.consultar).not.toHaveBeenCalled();
    expect(r.itens[0].estado).toBe("sem_telefone");
  });

  /**
   * A cicatriz principal deste arquivo: consulta que FALHOU nao pode virar
   * linha gravada. Gravar conferida_em depois de uma falha registraria "este
   * lead nao tem conversa" com base em nada, e o filtro da tela passaria a
   * oferecer como fila limpa quem ninguem conseguiu conferir.
   */
  it("falha na consulta nao grava nada e volta como nao_conferido", async () => {
    const d = deps({
      consultar: vi.fn(async () => ({ ultimaMensagemEm: null, falhou: true, detalhe: "WTS 503" })),
    });

    const r = await atualizarAtendimento([1], d);

    expect(d.gravar).not.toHaveBeenCalled();
    expect(r.itens[0].estado).toBe("nao_conferido");
    expect(r.itens[0].detalhe).toBe("WTS 503");
  });

  /**
   * A outra metade da mesma disciplina: nao SABER e' diferente de saber sem
   * conseguir GUARDAR. Se o WTS respondeu, a resposta vale; o que se perdeu
   * foi o cache, e o preco disso e' uma consulta a mais na proxima abertura.
   */
  it("falha ao gravar mantem o que o WTS respondeu, com o detalhe", async () => {
    const d = deps({
      consultar: vi.fn(async () => ({ ultimaMensagemEm: null, falhou: false, detalhe: null })),
      gravar: vi.fn(async () => {
        throw new Error("column does not exist");
      }),
    });

    const r = await atualizarAtendimento([1], d);

    expect(r.itens[0].estado).toBe("sem_conversa");
    expect(r.itens[0].detalhe).toContain("column does not exist");
  });

  it("um lead que estoura nao derruba os outros do lote", async () => {
    const d = deps({
      lerLeads: vi.fn(async () => [lead({ id: 1 }), lead({ id: 2 })]),
      consultar: vi.fn(async (e164: string) => {
        if (e164 === "5515991280217") throw new Error("boom");
        return { ultimaMensagemEm: null, falhou: false, detalhe: null };
      }),
    });

    const r = await atualizarAtendimento([1, 2], d);

    expect(r.itens).toHaveLength(2);
    expect(r.itens[0].estado).toBe("nao_conferido");
    expect(r.itens[0].detalhe).toContain("boom");
  });

  /**
   * O teto existe porque o WTS aguenta cerca de 500 chamadas a cada 5 minutos
   * e cada conferencia custa duas, disputando a cota com o envio. Quem passou
   * do teto volta com o que o cache tinha, e a proxima abertura da lista
   * confere.
   */
  it("respeita o teto de consultas por chamada", async () => {
    const ids = Array.from({ length: TETO_CONSULTAS + 5 }, (_, i) => i + 1);
    const d = deps({ lerLeads: vi.fn(async () => ids.map((id) => lead({ id }))) });

    const r = await atualizarAtendimento(ids, d);

    expect(d.consultar).toHaveBeenCalledTimes(TETO_CONSULTAS);
    expect(r.consultados).toBe(TETO_CONSULTAS);
    expect(r.itens).toHaveLength(ids.length);
    expect(r.itens[r.itens.length - 1].estado).toBe("nao_conferido");
  });

  it("gasta o teto nos primeiros da lista, que sao os leads mais recentes", async () => {
    const ids = [10, 20, 30];
    const d = deps({
      lerLeads: vi.fn(async () => [lead({ id: 30 }), lead({ id: 10 }), lead({ id: 20 })]),
    });

    await atualizarAtendimento(ids, { ...d, teto: 1 });

    // A ordem que vale e' a pedida pela tela (a da lista), nao a que o banco
    // devolveu: quem esta no topo da tela e' quem o vendedor esta olhando.
    expect(d.gravar).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.gravar).mock.calls[0][0]).toBe(10);
  });

  it("lead pedido que nao existe no banco some do resultado, sem quebrar", async () => {
    const d = deps({ lerLeads: vi.fn(async () => []) });
    const r = await atualizarAtendimento([1, 2], d);
    expect(r.itens).toEqual([]);
  });
});
