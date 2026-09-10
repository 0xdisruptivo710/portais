import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../_lib/supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("../_lib/imap", () => ({ abrirCaixa: vi.fn(), caixaDeTodosOsEmails: vi.fn() }));
vi.mock("../_lib/email", () => ({ paraEmailCru: vi.fn() }));
vi.mock("../_lib/ingestao", () => ({ ingerir: vi.fn() }));
vi.mock("../_lib/fila", () => ({ interpretarPendentes: vi.fn(), ativarPendentes: vi.fn() }));
vi.mock("mailparser", () => ({ simpleParser: vi.fn() }));

import { getSupabase } from "../_lib/supabase";
import { abrirCaixa, caixaDeTodosOsEmails } from "../_lib/imap";
import { paraEmailCru } from "../_lib/email";
import { ingerir } from "../_lib/ingestao";
import { ativarPendentes, interpretarPendentes } from "../_lib/fila";
import { simpleParser } from "mailparser";

const { default: handler } = await import("./varrer");

const CONTA_BASE = { id: 1, cliente_slug: "malentachi", ultimo_uid: 100, ultimo_erro: null, ativo: true };

interface MensagemFake {
  uid: number;
  source?: Buffer;
  /** Chave usada só no teste pra decidir o que paraEmailCru/ingerir devolvem para esta mensagem. */
  chave: string;
}

interface EstadoTeste {
  conta?: Record<string, unknown> | null;
  erroConta?: { message: string } | null;
  mensagens?: MensagemFake[];
  /** chave da mensagem -> resultado de ingerir() */
  resultadoIngest?: Record<string, "gravado" | "duplicado" | "ignorado">;
  /** chave da mensagem -> lança erro no ingerir/paraEmailCru (simula lead que estoura) */
  falhaIngest?: Set<string>;
  /** O que os drenadores de fila devolvem (o comportamento deles é testado em fila.test.ts). */
  resumoInterpretar?: { processado: number; falha: number };
  resumoAtivar?: { processado: number; falha: number };
  erroInterpretar?: Error;
  updateContaResultado?: { data: unknown; error: unknown };
  erroAbrirCaixa?: Error;
  erroFetch?: Error;
}

function construirClienteImapFake(estado: EstadoTeste) {
  const lockRelease = vi.fn();
  const logout = vi.fn(async () => {});
  const getMailboxLock = vi.fn(async () => ({ release: lockRelease }));
  const fetchChamadas: unknown[] = [];

  const fetch = vi.fn((...args: unknown[]) => {
    fetchChamadas.push(args);
    if (estado.erroFetch) throw estado.erroFetch;
    const mensagens = estado.mensagens ?? [];
    return (async function* () {
      for (const m of mensagens) yield m;
    })();
  });

  return { client: { getMailboxLock, fetch, logout }, lockRelease, logout, fetchChamadas };
}

function mockarTudo(estado: EstadoTeste = {}) {
  const chamadasUpdateConta: Record<string, unknown>[] = [];
  const updateContaResultado = estado.updateContaResultado ?? { data: [{ id: 1 }], error: null };

  const from = vi.fn((tabela: string) => {
    if (tabela === "portais_contas") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: estado.conta ?? CONTA_BASE,
              error: estado.erroConta ?? null,
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          chamadasUpdateConta.push(payload);
          return { eq: vi.fn(() => ({ select: vi.fn(async () => updateContaResultado) })) };
        }),
      };
    }
    throw new Error(`tabela inesperada no mock: ${tabela}`);
  });

  vi.mocked(getSupabase).mockReturnValue({ from } as never);

  const { client, lockRelease, logout, fetchChamadas } = construirClienteImapFake(estado);
  if (estado.erroAbrirCaixa) {
    vi.mocked(abrirCaixa).mockRejectedValue(estado.erroAbrirCaixa);
  } else {
    vi.mocked(abrirCaixa).mockResolvedValue(client as never);
  }
  vi.mocked(caixaDeTodosOsEmails).mockResolvedValue("[Gmail]/All Mail");

  // simpleParser e paraEmailCru, em conjunto, transformam `source` (que no
  // teste é só a chave da mensagem, ver MensagemFake) num EmailCru com
  // messageId = chave. Não precisam saber nada de MIME de verdade — quem
  // testa isso é email.test.ts.
  vi.mocked(simpleParser).mockImplementation(async (source: unknown) => {
    const chave = String(source);
    if (estado.falhaIngest?.has(chave)) throw new Error(`parse falhou para ${chave}`);
    return { messageId: chave } as never;
  });
  vi.mocked(paraEmailCru).mockImplementation(
    (parsed: unknown) =>
      ({
        messageId: (parsed as { messageId: string }).messageId,
        remetente: "leads@webmotors.com.br",
        assunto: "Novo lead",
        recebidoEm: "2026-09-10T12:00:00.000Z",
        texto: "corpo",
        html: "<p>corpo</p>",
        anexos: [],
      }) as never,
  );
  vi.mocked(ingerir).mockImplementation(async (email: unknown) => {
    const chave = (email as { messageId: string }).messageId;
    if (estado.falhaIngest?.has(chave)) throw new Error(`ingest falhou para ${chave}`);
    return estado.resultadoIngest?.[chave] ?? "gravado";
  });
  if (estado.erroInterpretar) {
    vi.mocked(interpretarPendentes).mockRejectedValue(estado.erroInterpretar);
  } else {
    vi.mocked(interpretarPendentes).mockResolvedValue(estado.resumoInterpretar ?? { processado: 0, falha: 0 });
  }
  vi.mocked(ativarPendentes).mockResolvedValue(estado.resumoAtivar ?? { processado: 0, falha: 0 });

  return { chamadasUpdateConta, lockRelease, logout, fetchChamadas };
}

function mensagem(chave: string, uid: number): MensagemFake {
  return { uid, source: Buffer.from(chave), chave };
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
  vi.mocked(abrirCaixa).mockReset();
  vi.mocked(caixaDeTodosOsEmails).mockReset();
  vi.mocked(paraEmailCru).mockReset();
  vi.mocked(ingerir).mockReset();
  vi.mocked(interpretarPendentes).mockReset();
  vi.mocked(ativarPendentes).mockReset();
  vi.mocked(simpleParser).mockReset();
  process.env.GMAIL_IMAP_USER = "conta@gmail.com";
  process.env.GMAIL_IMAP_APP_PASSWORD = "app-password-de-teste";
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.GMAIL_IMAP_USER;
  delete process.env.GMAIL_IMAP_APP_PASSWORD;
});

describe("GET /api/cron/varrer", () => {
  it("le a partir do ultimo_uid + 1, ingere, interpreta a fila e ativa os leads pendentes", async () => {
    const { fetchChamadas, chamadasUpdateConta } = mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 100 },
      mensagens: [mensagem("m1", 101), mensagem("m2", 102)],
      resumoInterpretar: { processado: 2, falha: 0 },
      resumoAtivar: { processado: 2, falha: 0 },
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));
    expect(r.status).toBe(200);
    const corpo = await r.json();

    expect(corpo.lidos).toBe(2);
    expect(corpo.gravado).toBe(2);
    expect(corpo.processado).toBe(2);
    expect(corpo.ativado).toBe(2);
    expect(corpo.falha).toBe(0);
    expect(corpo.ultimo_uid).toBe(102);
    expect(vi.mocked(interpretarPendentes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ativarPendentes)).toHaveBeenCalledTimes(1);

    // Range pedido ao IMAP tem que comecar depois do cursor salvo (101:*),
    // nao do zero -- e' isso que faz a varredura ser incremental.
    const [range] = fetchChamadas[0] as [{ uid: string }, unknown];
    expect(range.uid).toBe("101:*");

    expect(chamadasUpdateConta.at(-1)).toEqual({ ultimo_uid: 102, ultimo_erro: null });
  });

  it("um lead que estoura no ingest nao impede os outros da mesma leva", async () => {
    const { chamadasUpdateConta } = mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 0 },
      mensagens: [mensagem("m1", 1), mensagem("m2", 2), mensagem("m3", 3)],
      falhaIngest: new Set(["m2"]),
      resumoInterpretar: { processado: 2, falha: 0 },
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));
    expect(r.status).toBe(200);
    const corpo = await r.json();

    expect(corpo.lidos).toBe(3);
    expect(corpo.gravado).toBe(2);
    expect(corpo.falha).toBe(1);
    expect(corpo.processado).toBe(2);
    // uid avanca ate a ultima mensagem LIDA, mesmo que uma tenha falhado no
    // meio do caminho -- senao a mensagem quebrada travaria a fila pra sempre.
    expect(corpo.ultimo_uid).toBe(3);
    expect(chamadasUpdateConta.at(-1)).toEqual({ ultimo_uid: 3, ultimo_erro: null });
  });

  it("soma no resumo as falhas que os drenadores registraram", async () => {
    mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 0 },
      mensagens: [mensagem("m1", 1), mensagem("m2", 2)],
      resumoInterpretar: { processado: 1, falha: 1 },
      resumoAtivar: { processado: 1, falha: 2 },
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));
    expect(r.status).toBe(200);
    const corpo = await r.json();

    expect(corpo.processado).toBe(1);
    expect(corpo.ativado).toBe(1);
    // Falha do ingest (0 aqui) + falhas das duas filas: o resumo do cron é o
    // único lugar onde a execução inteira aparece num número só.
    expect(corpo.falha).toBe(3);
  });

  it("falha do drenador grava ultimo_erro e responde 500, sem falhar calado", async () => {
    const { chamadasUpdateConta } = mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 0 },
      mensagens: [mensagem("m1", 1)],
      erroInterpretar: new Error("fila fora do ar"),
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));

    expect(r.status).toBe(500);
    expect(chamadasUpdateConta.at(-1)).toEqual({ ultimo_erro: "fila fora do ar" });
    // O cursor já foi salvo antes de drenar: uma falha na fila não pode fazer
    // a próxima execução reler as mesmas mensagens do IMAP.
    expect(chamadasUpdateConta.some((c) => c.ultimo_uid === 1)).toBe(true);
  });

  it("respeita o teto de 200 mensagens por execucao", async () => {
    const mensagens = Array.from({ length: 250 }, (_, i) => mensagem(`m${i}`, i + 1));
    const { chamadasUpdateConta } = mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 0 },
      mensagens,
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));
    const corpo = await r.json();

    expect(corpo.lidos).toBe(200);
    expect(corpo.ultimo_uid).toBe(200);
    expect(chamadasUpdateConta.at(-1)?.ultimo_uid).toBe(200);
  });

  it("mensagem sem source (fonte ausente) e' pulada e contada, sem quebrar a leva", async () => {
    mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 0 },
      mensagens: [{ uid: 1, chave: "sem-fonte" }, mensagem("m2", 2)],
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));
    const corpo = await r.json();

    expect(corpo.semFonte).toBe(1);
    expect(corpo.gravado).toBe(1);
  });

  it("falha de autenticacao IMAP grava ultimo_erro na conta e responde 500", async () => {
    const { chamadasUpdateConta } = mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 100 },
      erroAbrirCaixa: new Error("Invalid credentials"),
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));

    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo.erro).toContain("Invalid credentials");
    expect(chamadasUpdateConta).toEqual([{ ultimo_erro: "Invalid credentials" }]);
    // Falha de autenticacao nunca chega a ler nada: ultimo_uid nao pode
    // avancar quando a varredura nem comecou.
    expect(chamadasUpdateConta.some((c) => "ultimo_uid" in c)).toBe(false);
  });

  it("falha no meio da varredura (fetch estoura) tambem grava ultimo_erro e responde 500, sem falhar calado", async () => {
    const { chamadasUpdateConta } = mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 100 },
      erroFetch: new Error("Connection closed"),
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));

    expect(r.status).toBe(500);
    expect(chamadasUpdateConta).toEqual([{ ultimo_erro: "Connection closed" }]);
  });

  it("credenciais IMAP ausentes no ambiente: 500 com ultimo_erro, sem tentar conectar", async () => {
    const antigoUsuario = process.env.GMAIL_IMAP_USER;
    const antigaSenha = process.env.GMAIL_IMAP_APP_PASSWORD;
    delete process.env.GMAIL_IMAP_USER;
    delete process.env.GMAIL_IMAP_APP_PASSWORD;

    const { chamadasUpdateConta } = mockarTudo({ conta: CONTA_BASE });

    const r = await handler(new Request("https://x/api/cron/varrer"));

    expect(r.status).toBe(500);
    expect(vi.mocked(abrirCaixa)).not.toHaveBeenCalled();
    expect(chamadasUpdateConta).toHaveLength(1);

    if (antigoUsuario !== undefined) process.env.GMAIL_IMAP_USER = antigoUsuario;
    if (antigaSenha !== undefined) process.env.GMAIL_IMAP_APP_PASSWORD = antigaSenha;
  });

  it("conta nao encontrada: 500, sem tentar abrir o IMAP", async () => {
    mockarTudo({ conta: null, erroConta: { message: "not found" } });

    const r = await handler(new Request("https://x/api/cron/varrer"));

    expect(r.status).toBe(500);
    expect(vi.mocked(abrirCaixa)).not.toHaveBeenCalled();
  });

  it("sem mensagem nova, ainda drena a fila que ja estava no banco", async () => {
    // O corte que este teste tranca: o cron antigo só interpretava os
    // message_id que ele mesmo tinha acabado de gravar. Evento pré-existente
    // com status 'novo' (backfill, reprocessamento) nunca virava lead.
    const { chamadasUpdateConta } = mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 100 },
      mensagens: [],
      resumoInterpretar: { processado: 3, falha: 0 },
      resumoAtivar: { processado: 3, falha: 0 },
    });

    const r = await handler(new Request("https://x/api/cron/varrer"));
    expect(r.status).toBe(200);
    const corpo = await r.json();

    expect(corpo.lidos).toBe(0);
    expect(corpo.ultimo_uid).toBe(100);
    expect(corpo.processado).toBe(3);
    expect(corpo.ativado).toBe(3);
    expect(vi.mocked(interpretarPendentes)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ativarPendentes)).toHaveBeenCalledTimes(1);
    expect(chamadasUpdateConta.at(-1)).toEqual({ ultimo_uid: 100, ultimo_erro: null });
  });

  it("sempre desconecta do IMAP ao final, mesmo quando a varredura falha", async () => {
    const { logout } = mockarTudo({
      conta: { ...CONTA_BASE, ultimo_uid: 100 },
      erroFetch: new Error("Connection closed"),
    });

    await handler(new Request("https://x/api/cron/varrer"));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
