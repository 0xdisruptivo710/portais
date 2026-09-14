import { beforeEach, describe, expect, it, vi } from "vitest";

const single = vi.fn();
const eqConfig = vi.fn(() => ({ single }));
const selectConfig = vi.fn(() => ({ eq: eqConfig }));

const dentro = vi.fn();
const selectLeads = vi.fn(() => ({ in: dentro }));

const selectVolta = vi.fn();
const eqUpdate = vi.fn(() => ({ select: selectVolta }));
const update = vi.fn((_campos: Record<string, unknown>) => ({ eq: eqUpdate }));

vi.mock("./_lib/supabase", () => ({
  getSupabase: () => ({
    from: (tabela: string) =>
      tabela === "portais_config" ? { select: selectConfig } : { select: selectLeads, update },
  }),
}));
vi.mock("./_lib/conversa", async (original) => ({
  ...(await original<typeof import("./_lib/conversa")>()),
  consultarConversaNoWts: vi.fn(),
}));

import { consultarConversaNoWts } from "./_lib/conversa";
import { assinarSessao, COOKIE_ADMIN } from "./_lib/sessao";

const { POST: handler } = await import("./conversas");

const SEGREDO_SESSAO = "segredo-de-teste-bem-longo-mesmo";
const ORIGEM = "https://painel.exemplo.com";

function comSessao(corpo: unknown): Request {
  const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
  return new Request("https://painel.exemplo.com/api/conversas", {
    method: "POST",
    headers: { cookie, origin: ORIGEM, "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

beforeEach(() => {
  // A origem propria sai da URL da requisicao, nao de variavel de ambiente
  // (ver exigirOrigemConfiavel): por isso o Request e' montado no mesmo host.
  process.env.ADMIN_SESSION_SECRET = SEGREDO_SESSAO;

  single.mockReset();
  single.mockResolvedValue({ data: { janela_conversa_dias: 7 }, error: null });

  dentro.mockReset();
  dentro.mockResolvedValue({
    data: [{ id: 1, telefone_e164: "5515991280217", conversa_conferida_em: null, conversa_ultima_mensagem_em: null }],
    error: null,
  });

  update.mockClear();
  selectVolta.mockReset();
  selectVolta.mockResolvedValue({ data: [{ id: 1 }], error: null });

  vi.mocked(consultarConversaNoWts).mockReset();
  vi.mocked(consultarConversaNoWts).mockResolvedValue({
    ultimaMensagemEm: new Date(Date.now() - 60 * 60 * 1000),
    falhou: false,
    detalhe: null,
  });
});

describe("POST /api/conversas", () => {
  it("devolve o estado de atendimento de cada lead pedido", async () => {
    const r = await handler(comSessao({ leadIds: [1] }));
    expect(r.status).toBe(200);

    const corpo = (await r.json()) as { itens: { lead_id: number; estado: string }[]; consultados: number };
    expect(corpo.itens).toHaveLength(1);
    expect(corpo.itens[0]).toMatchObject({ lead_id: 1, estado: "em_atendimento" });
    expect(corpo.consultados).toBe(1);
  });

  it("grava a data da ultima mensagem no lead, para a proxima abertura nao consultar de novo", async () => {
    await handler(comSessao({ leadIds: [1] }));
    expect(update).toHaveBeenCalledTimes(1);
    const gravado = update.mock.calls[0][0];
    expect(gravado).toHaveProperty("conversa_ultima_mensagem_em");
    expect(gravado).toHaveProperty("conversa_conferida_em");
  });

  // A coluna pode nao existir ainda (migration nao rodou). A gravacao falha,
  // mas a CONSULTA ao WTS deu certo: a resposta continua valendo, o que se
  // perdeu foi o cache. A tela nao cai e o detalhe explica o que houve.
  it("falha ao gravar nao derruba a tela nem apaga o que o WTS respondeu", async () => {
    selectVolta.mockResolvedValue({ data: null, error: { message: "column does not exist" } });

    const r = await handler(comSessao({ leadIds: [1] }));

    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { itens: { estado: string; detalhe: string | null }[] };
    expect(corpo.itens[0].estado).toBe("em_atendimento");
    expect(corpo.itens[0].detalhe).toContain("column does not exist");
  });

  it("consulta que falha nao grava nada", async () => {
    vi.mocked(consultarConversaNoWts).mockResolvedValue({
      ultimaMensagemEm: null,
      falhou: true,
      detalhe: "WTS 503",
    });

    const r = await handler(comSessao({ leadIds: [1] }));

    expect(update).not.toHaveBeenCalled();
    const corpo = (await r.json()) as { itens: { estado: string }[] };
    expect(corpo.itens[0].estado).toBe("nao_conferido");
  });

  it("recusa lista invalida em vez de repassar ao banco", async () => {
    const r = await handler(comSessao({ leadIds: [] }));
    expect(r.status).toBe(400);
    expect(consultarConversaNoWts).not.toHaveBeenCalled();
  });

  it("recusa lista maior que o teto da pagina", async () => {
    const demais = Array.from({ length: 200 }, (_, i) => i + 1);
    const r = await handler(comSessao({ leadIds: demais }));
    expect(r.status).toBe(400);
  });

  it("json invalido devolve 400", async () => {
    const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
    const r = await handler(
      new Request("https://painel.exemplo.com/api/conversas", {
        method: "POST",
        headers: { cookie, origin: ORIGEM, "content-type": "application/json" },
        body: "nao e json",
      }),
    );
    expect(r.status).toBe(400);
  });

  // Sem config legivel nao da para saber a janela de recencia, e chutar uma
  // janela mudaria a resposta que a tela da'. A guarda da conversa.ts ja' tem
  // um padrao para isso; aqui o padrao vale igual.
  it("config ausente nao derruba a consulta: vale a janela padrao", async () => {
    single.mockResolvedValue({ data: null, error: { message: "sem config" } });
    const r = await handler(comSessao({ leadIds: [1] }));
    expect(r.status).toBe(200);
  });
});

describe("guardas de /api/conversas", () => {
  it("recusa com 401 quem chama sem cookie de sessao", async () => {
    const r = await handler(
      new Request("https://painel.exemplo.com/api/conversas", {
        method: "POST",
        headers: { origin: ORIGEM, "content-type": "application/json" },
        body: JSON.stringify({ leadIds: [1] }),
      }),
    );
    expect(r.status).toBe(401);
  });

  // O endpoint grava no banco e gasta cota do WTS: origem desconhecida nao
  // entra, pelo mesmo motivo dos outros POST do painel.
  it("recusa origem desconhecida", async () => {
    const cookie = `${COOKIE_ADMIN}=${assinarSessao(Date.now() + 60_000, SEGREDO_SESSAO)}`;
    const r = await handler(
      new Request("https://painel.exemplo.com/api/conversas", {
        method: "POST",
        headers: { cookie, origin: "https://site-qualquer.com", "content-type": "application/json" },
        body: JSON.stringify({ leadIds: [1] }),
      }),
    );
    expect(r.status).toBe(403);
  });
});
