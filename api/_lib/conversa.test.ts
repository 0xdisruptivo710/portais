import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conferirConversaNoWts,
  consultarConversaNoWts,
  conversaEmAndamento,
  decidirConversaAberta,
  JANELA_CONVERSA_PADRAO_DIAS,
  ultimaMensagemDaSessao,
} from "./conversa";

const AGORA = new Date("2026-09-12T15:00:00Z");
const CONTATO = "contato-1";

describe("ultimaMensagemDaSessao", () => {
  it("pega a mais recente entre as tres datas, nao a primeira que existir", () => {
    const d = ultimaMensagemDaSessao({
      lastMessageIn: "2026-09-12T10:00:00Z",
      lastMessageOut: "2026-09-12T14:30:00Z",
      lastInteractionDate: "2026-09-11T09:00:00Z",
    });
    expect(d?.toISOString()).toBe("2026-09-12T14:30:00.000Z");
  });

  it("devolve null quando a sessao nao traz nenhuma data", () => {
    expect(ultimaMensagemDaSessao({ status: "OPEN" })).toBeNull();
  });

  it("ignora data invalida em vez de virar Invalid Date", () => {
    expect(ultimaMensagemDaSessao({ lastMessageIn: "nao e data" })).toBeNull();
    expect(
      ultimaMensagemDaSessao({ lastMessageIn: "nao e data", lastMessageOut: "2026-09-12T14:00:00Z" })?.toISOString(),
    ).toBe("2026-09-12T14:00:00.000Z");
  });
});

describe("decidirConversaAberta", () => {
  const args = { contatoId: CONTATO, janelaDias: 7, agora: AGORA };

  it("libera quando o contato nao tem nenhuma sessao", () => {
    const r = decidirConversaAberta({ ...args, sessoes: [] });
    expect(r).toEqual({ suprimir: false, motivo: null, falhou: false });
  });

  // O caso real: troca de mensagens no mesmo dia, e o primeiro contato
  // automatico caiu no meio dela.
  it("suprime quando a ultima mensagem foi horas atras, com o motivo legivel", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [{ contactId: CONTATO, lastMessageIn: "2026-09-12T13:00:00Z", status: "OPEN" }],
    });
    expect(r.suprimir).toBe(true);
    expect(r.falhou).toBe(false);
    expect(r.motivo).toBe("ja existe conversa no WTS, ultima mensagem ha 2h");
  });

  it("libera quando a conversa e antiga, fora do criterio de recencia", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [{ contactId: CONTATO, lastMessageIn: "2026-06-01T13:00:00Z", status: "OPEN" }],
    });
    expect(r.suprimir).toBe(false);
  });

  // O criterio e recencia de mensagem de verdade, nunca o status da sessao:
  // atendente que fecha logo depois de "Ok, combinado" deixaria CLOSED em
  // cima de uma negociacao viva.
  it("suprime sessao CLOSED com mensagem recente", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [{ contactId: CONTATO, lastMessageOut: "2026-09-12T14:55:00Z", status: "CLOSED" }],
    });
    expect(r.suprimir).toBe(true);
    expect(r.motivo).toContain("ha 5min");
  });

  // ... e o inverso: sessao esquecida aberta, sem mensagem ha meses, nao
  // pode bloquear um lead que voltou por outro portal.
  it("libera sessao OPEN sem mensagem dentro da janela", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [{ contactId: CONTATO, lastMessageIn: "2026-01-02T13:00:00Z", status: "OPEN" }],
    });
    expect(r.suprimir).toBe(false);
  });

  it("olha a sessao mais recente quando o contato tem varias", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [
        { contactId: CONTATO, lastMessageIn: "2026-01-02T13:00:00Z" },
        { contactId: CONTATO, lastMessageIn: "2026-09-12T12:00:00Z" },
      ],
    });
    expect(r.suprimir).toBe(true);
    expect(r.motivo).toContain("ha 3h");
  });

  // A API do WTS e .NET e ignora em SILENCIO todo parametro que nao
  // reconhece: um dia em que "ContactId" deixe de existir, a listagem volta
  // com a conta inteira. Sem esta rede, isso viraria supressao em massa.
  it("descarta sessao de outro contato, mesmo que a API tenha ignorado o filtro", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [
        { contactId: "outro-contato", lastMessageIn: "2026-09-12T14:00:00Z" },
        { contactId: "mais-um", lastMessageIn: "2026-09-12T14:00:00Z" },
      ],
    });
    expect(r.suprimir).toBe(false);
  });

  // Mas se NENHUM item trouxer contactId, nao da para conferir de quem sao:
  // isso e contrato mudado, e contrato mudado nao pode virar "nao ha
  // conversa" em silencio.
  it("trata lista sem contactId em nenhum item como falha, nao como ausencia de conversa", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [{ lastMessageIn: "2026-09-12T14:00:00Z" }],
    });
    expect(r.suprimir).toBe(true);
    expect(r.falhou).toBe(true);
    expect(r.motivo).toContain("nao foi possivel conferir");
  });

  it("suprime na borda exata da janela, do lado seguro", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [{ contactId: CONTATO, lastMessageIn: "2026-09-05T15:00:00Z" }],
    });
    expect(r.suprimir).toBe(true);
  });

  it("suprime data no futuro (relogio fora de hora) em vez de liberar", () => {
    const r = decidirConversaAberta({
      ...args,
      sessoes: [{ contactId: CONTATO, lastMessageIn: "2026-09-13T15:00:00Z" }],
    });
    expect(r.suprimir).toBe(true);
  });
});

describe("conferirConversaNoWts", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("WTS_TOKEN", "token-de-teste");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function conferir() {
    return conferirConversaNoWts({ e164: "5515991280217", janelaDias: 7, agora: AGORA });
  }

  function responder(porUrl: (url: string) => unknown) {
    fetchMock.mockImplementation(async (url: unknown) => {
      const corpo = porUrl(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
    });
  }

  it("filtra as sessoes pelo contato no servidor, em PascalCase", async () => {
    responder((url) => (url.includes("/contact/") ? { id: CONTATO } : { items: [] }));

    await conferir();

    const urlSessao = String(fetchMock.mock.calls[1][0]);
    expect(urlSessao).toContain("/chat/v2/session");
    expect(urlSessao).toContain(`ContactId=${CONTATO}`);
    expect(urlSessao).toContain("PageSize=100");
  });

  // Contato que nunca falou com a loja nao tem conversa nenhuma: nao ha o que
  // consultar, e pedir a listagem seria uma chamada de rede a toa.
  it("libera sem consultar sessao quando o contato nem existe no WTS", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "nao existe" });

    const r = await conferir();

    expect(r).toEqual({ suprimir: false, motivo: null, falhou: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("suprime quando o contato tem conversa recente", async () => {
    responder((url) =>
      url.includes("/contact/")
        ? { id: CONTATO }
        : { items: [{ contactId: CONTATO, lastMessageIn: "2026-09-12T13:00:00Z" }] },
    );

    const r = await conferir();

    expect(r.suprimir).toBe(true);
    expect(r.falhou).toBe(false);
    expect(r.motivo).toContain("ja existe conversa no WTS");
  });

  it("libera quando o contato existe mas a conversa e antiga", async () => {
    responder((url) =>
      url.includes("/contact/")
        ? { id: CONTATO }
        : { items: [{ contactId: CONTATO, lastMessageIn: "2026-05-01T13:00:00Z" }] },
    );

    expect((await conferir()).suprimir).toBe(false);
  });

  // Fail-closed: nao saber se existe negociacao em andamento nao pode virar
  // permissao para mandar o primeiro contato.
  it("falha na listagem de sessoes vira supressao, nunca envio", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/contact/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: CONTATO }) };
      }
      return { ok: false, status: 503, text: async () => "indisponivel" };
    });

    const r = await conferir();

    expect(r.suprimir).toBe(true);
    expect(r.falhou).toBe(true);
    expect(r.motivo).toContain("nao foi possivel conferir");
    expect(r.motivo).toContain("503");
  });

  // 500 na rota de contato e "contato inexistente" (contrato do WTS). Em
  // qualquer outro status nao da para afirmar isso, e a duvida fecha.
  it("erro que nao e 500 na busca de contato tambem fecha", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => "unauthorized" });

    const r = await conferir();

    expect(r.suprimir).toBe(true);
    expect(r.falhou).toBe(true);
  });

  it("resposta de sessao sem items vira ausencia de conversa, nao falha", async () => {
    responder((url) => (url.includes("/contact/") ? { id: CONTATO } : {}));

    expect(await conferir()).toEqual({ suprimir: false, motivo: null, falhou: false });
  });

  it("contato sem id utilizavel fecha em vez de liberar", async () => {
    responder(() => ({ nome: "Fulano" }));

    const r = await conferir();

    expect(r.suprimir).toBe(true);
    expect(r.falhou).toBe(true);
  });
});

describe("JANELA_CONVERSA_PADRAO_DIAS", () => {
  it("e um numero de dias positivo", () => {
    expect(JANELA_CONVERSA_PADRAO_DIAS).toBeGreaterThan(0);
  });
});

/**
 * A MESMA consulta de rede da guarda de envio, devolvendo o dado cru em vez
 * da decisão. É o que permite a lista do painel responder "esse lead já está
 * em atendimento" sem duplicar a leitura do WTS nem a regra da janela.
 */
describe("consultarConversaNoWts", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("WTS_TOKEN", "token-de-teste");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function responder(porUrl: (url: string) => unknown) {
    fetchMock.mockImplementation(async (url: unknown) => {
      const corpo = porUrl(String(url));
      return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
    });
  }

  it("devolve a data da ultima mensagem, sem decidir nada sobre janela", async () => {
    responder((url) =>
      url.includes("/contact/")
        ? { id: CONTATO }
        : { items: [{ contactId: CONTATO, lastMessageIn: "2026-09-12T13:00:00Z" }] },
    );

    const r = await consultarConversaNoWts("5515991280217");

    expect(r.ultimaMensagemEm?.toISOString()).toBe("2026-09-12T13:00:00.000Z");
    expect(r.falhou).toBe(false);
    expect(r.detalhe).toBeNull();
  });

  // Contato inexistente e' RESPOSTA: quem nunca falou com a loja nao tem
  // conversa. Isso nao pode se confundir com falha de consulta.
  it("contato inexistente e' ausencia de conversa, nao falha", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "nao existe" });

    const r = await consultarConversaNoWts("5515991280217");

    expect(r).toEqual({ ultimaMensagemEm: null, falhou: false, detalhe: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falha de rede volta como falhou, com o detalhe, e NUNCA como sem conversa", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).includes("/contact/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: CONTATO }) };
      }
      return { ok: false, status: 503, text: async () => "indisponivel" };
    });

    const r = await consultarConversaNoWts("5515991280217");

    expect(r.falhou).toBe(true);
    expect(r.ultimaMensagemEm).toBeNull();
    expect(r.detalhe).toContain("503");
  });

  it("listagem que volta sem dono (contrato mudado) tambem e' falha", async () => {
    responder((url) =>
      url.includes("/contact/") ? { id: CONTATO } : { items: [{ lastMessageIn: "2026-09-12T13:00:00Z" }] },
    );

    const r = await consultarConversaNoWts("5515991280217");

    expect(r.falhou).toBe(true);
    expect(r.detalhe).toContain("sessao sem contactId");
  });
});

/**
 * O criterio de recencia isolado de onde a data veio. E' a mesma conta na
 * hora do envio e na lista do painel: sem isso, a tela poderia dizer "em
 * atendimento" para um lead que o envio libera, ou o contrario.
 */
describe("conversaEmAndamento", () => {
  it("conta como em andamento dentro da janela", () => {
    expect(conversaEmAndamento(new Date("2026-09-12T13:00:00Z"), 7, AGORA)).toBe(true);
  });

  it("nao conta fora da janela", () => {
    expect(conversaEmAndamento(new Date("2026-05-01T13:00:00Z"), 7, AGORA)).toBe(false);
  });

  it("sem data nenhuma nao e' conversa em andamento", () => {
    expect(conversaEmAndamento(null, 7, AGORA)).toBe(false);
  });

  it("data no futuro (relogio fora de hora) conta como em andamento", () => {
    expect(conversaEmAndamento(new Date("2026-09-13T15:00:00Z"), 7, AGORA)).toBe(true);
  });
});
