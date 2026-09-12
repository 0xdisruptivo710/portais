import { describe, expect, it, vi } from "vitest";

import {
  executarFatia,
  PAUSA_ENTRE_ENVIOS_MS,
  PRAZO_REQUISICAO_MS,
  resumirLote,
  TETO_POR_LOTE,
  TETO_POR_REQUISICAO,
  type DepsLote,
  type LeadDoLote,
} from "./lote";

const ENVIADO = {
  acao: "enviar" as const,
  motivo: null,
  respostaWts: { id: "msg-1" },
  verificado: false,
  verificacaoDetalhe: "status QUEUED (id msg-1)",
  podeForcar: false,
};

const SUPRIMIDO = {
  acao: "suprimido" as const,
  motivo: "ja existe conversa no WTS, ultima mensagem ha 2h",
  respostaWts: null,
  verificado: false,
  verificacaoDetalhe: null,
  podeForcar: true,
};

/**
 * Relógio e sono de mentira: o lote real espaça os envios em segundos, e um
 * teste que dormisse de verdade levaria minutos. `dormir` avança o relógio
 * exatamente como o sono avançaria, então o corte por prazo é exercitado com
 * o mesmo tempo que aconteceria em produção.
 */
function criarDeps(
  ativar: (leadId: number) => Promise<typeof ENVIADO | typeof SUPRIMIDO>,
  opcoes: { jaEnviados?: Record<number, string>; trabalhoMs?: number } = {},
) {
  let relogio = 0;
  const dormidas: number[] = [];
  const ativados: number[] = [];
  const deps: DepsLote = {
    ativar: async (leadId) => {
      ativados.push(leadId);
      relogio += opcoes.trabalhoMs ?? 0;
      return ativar(leadId);
    },
    jaEnviado: async (leadId) => opcoes.jaEnviados?.[leadId] ?? null,
    dormir: async (ms) => {
      dormidas.push(ms);
      relogio += ms;
    },
    agora: () => relogio,
  };
  return { deps, dormidas, ativados };
}

describe("executarFatia: ritmo", () => {
  it("espaça os envios, um a um, em vez de disparar a fila inteira de uma vez", async () => {
    const { deps, dormidas } = criarDeps(async () => ENVIADO);

    const fatia = await executarFatia([1, 2, 3], deps);

    expect(fatia.resultados.map((r) => r.situacao)).toEqual(["enviado", "enviado", "enviado"]);
    expect(dormidas).toEqual([PAUSA_ENTRE_ENVIOS_MS, PAUSA_ENTRE_ENVIOS_MS, PAUSA_ENTRE_ENVIOS_MS]);
  });

  /**
   * A pausa depois do último envio não é desperdício: ela é o intervalo antes
   * do primeiro envio da próxima requisição. Sem ela, a cadência se perderia
   * exatamente na emenda entre uma fatia e a seguinte.
   */
  it("pausa também depois do último envio da fatia, para a emenda manter o ritmo", async () => {
    const { deps, dormidas } = criarDeps(async () => ENVIADO);

    await executarFatia([1], deps);

    expect(dormidas).toEqual([PAUSA_ENTRE_ENVIOS_MS]);
  });

  it("não gasta pausa com lead bloqueado: nenhuma mensagem saiu dali", async () => {
    const { deps, dormidas } = criarDeps(async () => SUPRIMIDO);

    await executarFatia([1, 2], deps);

    expect(dormidas).toEqual([]);
  });

  it("corta no teto por requisição e devolve o resto para a próxima", async () => {
    const ids = Array.from({ length: TETO_POR_REQUISICAO + 3 }, (_, i) => i + 1);
    const { deps } = criarDeps(async () => ENVIADO);

    const fatia = await executarFatia(ids, deps);

    expect(fatia.resultados).toHaveLength(TETO_POR_REQUISICAO);
    expect(fatia.restantes).toEqual(ids.slice(TETO_POR_REQUISICAO));
    expect(fatia.parado).toBe("fatia");
  });

  /**
   * A function da Vercel tem 300s. O lote inteiro não cabe numa requisição, e
   * o jeito de isso não virar uma execução morta no meio do caminho é a
   * própria fatia parar antes do teto e devolver o que sobrou.
   */
  it("para no prazo da requisição, mesmo antes do teto, e devolve o que sobrou", async () => {
    const ids = Array.from({ length: TETO_POR_REQUISICAO }, (_, i) => i + 1);
    // Cada lead custa mais que o prazo inteiro: só o primeiro cabe.
    const { deps } = criarDeps(async () => ENVIADO, { trabalhoMs: PRAZO_REQUISICAO_MS });

    const fatia = await executarFatia(ids, deps);

    expect(fatia.resultados).toHaveLength(1);
    expect(fatia.parado).toBe("prazo");
    expect(fatia.restantes).toEqual(ids.slice(1));
  });

  it("fila vazia não inventa envio nenhum", async () => {
    const { deps, ativados } = criarDeps(async () => ENVIADO);

    const fatia = await executarFatia([], deps);

    expect(fatia).toEqual({ resultados: [], restantes: [], parado: null });
    expect(ativados).toEqual([]);
  });
});

describe("executarFatia: retomada e idempotência", () => {
  /**
   * O lote pode morrer no meio (timeout da function, aba fechada, rede). Ao
   * retomar, quem já recebeu não pode receber de novo — e a prova de que
   * recebeu é o estado do próprio lead, não um contador em memória.
   */
  it("lead que já tem enviado_em é pulado, sem tocar no WTS", async () => {
    const { deps, ativados } = criarDeps(async () => ENVIADO, {
      jaEnviados: { 2: "2026-09-12T10:00:00.000Z" },
    });

    const fatia = await executarFatia([1, 2, 3], deps);

    expect(ativados).toEqual([1, 3]);
    expect(fatia.resultados[1]).toMatchObject({ lead_id: 2, situacao: "bloqueado" });
    expect(fatia.resultados[1].motivo).toMatch(/ja enviado/i);
  });

  it("lote inteiro já enviado não manda nada e não dorme", async () => {
    const { deps, ativados, dormidas } = criarDeps(async () => ENVIADO, {
      jaEnviados: { 1: "2026-09-12T10:00:00.000Z", 2: "2026-09-12T10:01:00.000Z" },
    });

    const fatia = await executarFatia([1, 2], deps);

    expect(ativados).toEqual([]);
    expect(dormidas).toEqual([]);
    expect(fatia.resultados.every((r) => r.situacao === "bloqueado")).toBe(true);
  });
});

describe("executarFatia: um lead ruim não derruba o lote", () => {
  it("bloqueado é pulado e relatado com o motivo, e o lote segue", async () => {
    const { deps } = criarDeps(async (id) => (id === 2 ? SUPRIMIDO : ENVIADO));

    const fatia = await executarFatia([1, 2, 3], deps);

    expect(fatia.resultados.map((r) => r.situacao)).toEqual(["enviado", "bloqueado", "enviado"]);
    expect(fatia.resultados[1].motivo).toBe(SUPRIMIDO.motivo);
  });

  it("erro no envio vira falhou, com o erro por escrito, e o lote segue", async () => {
    const { deps } = criarDeps(async (id) => {
      if (id === 2) throw new Error("WTS POST 502");
      return ENVIADO;
    });

    const fatia = await executarFatia([1, 2, 3], deps);

    expect(fatia.resultados.map((r) => r.situacao)).toEqual(["enviado", "falhou", "enviado"]);
    expect(fatia.resultados[1].motivo).toBe("WTS POST 502");
  });

  /**
   * Um erro no envio pode ter saído mesmo assim (o WTS já recebeu e a resposta
   * é que se perdeu). Pausar depois dele é a escolha conservadora: o custo é
   * tempo, e o risco do contrário é dobrar a cadência sem perceber.
   */
  it("pausa depois de uma falha também, porque a mensagem pode ter saído", async () => {
    const { deps, dormidas } = criarDeps(async () => {
      throw new Error("timeout");
    });

    await executarFatia([1], deps);

    expect(dormidas).toEqual([PAUSA_ENTRE_ENVIOS_MS]);
  });

  /**
   * QUEUED do WTS já apareceu em mensagem que nunca chegou a ninguém. O
   * resultado por lead carrega a conferência como ela é, sem arredondar.
   */
  it("não afirma entrega sem prova: repassa verificado e o detalhe", async () => {
    const { deps } = criarDeps(async () => ENVIADO);

    const fatia = await executarFatia([1], deps);

    expect(fatia.resultados[0].verificado).toBe(false);
    expect(fatia.resultados[0].verificacao_detalhe).toBe("status QUEUED (id msg-1)");
  });
});

const CONFIG = {
  kill_switch: false,
  wts_from: "5515999990000",
  texto_boas_vindas: "Oi {nome}, tudo bem? Vi seu interesse no{veiculo}.",
  janela_supressao_dias: 30,
};

function lead(id: number, telefone: string | null, extra: Partial<LeadDoLote> = {}): LeadDoLote {
  return {
    id,
    portal: "webmotors",
    nome: "Fulano",
    veiculo_texto: "Civic 2020",
    telefone_e164: telefone,
    enviado_em: null,
    ...extra,
  };
}

const AGORA = new Date("2026-09-12T12:00:00.000Z");

describe("resumirLote: o número que o operador precisa olhar antes de confirmar", () => {
  it("conta quantas mensagens saem e para quantas pessoas distintas", () => {
    const resumo = resumirLote({
      leads: [lead(1, "5515991280217"), lead(2, "5515991280218"), lead(3, "5515991280217")],
      cfg: CONFIG,
      ultimoContatoPorTelefone: new Map(),
      agora: AGORA,
    });

    expect(resumo.vao_sair).toBe(3);
    expect(resumo.pessoas).toBe(2);
    // O mesmo telefone duas vezes na seleção: a janela de recontato vai
    // suprimir o repetido na hora do envio, e isso precisa estar na tela.
    expect(resumo.repetidos).toBe(1);
  });

  it("kill-switch ligado bloqueia o lote inteiro, com o motivo", () => {
    const resumo = resumirLote({
      leads: [lead(1, "5515991280217"), lead(2, "5515991280218")],
      cfg: { ...CONFIG, kill_switch: true },
      ultimoContatoPorTelefone: new Map(),
      agora: AGORA,
    });

    expect(resumo.vao_sair).toBe(0);
    expect(resumo.bloqueados).toBe(2);
    expect(resumo.motivos).toEqual([{ motivo: "kill-switch ligado", quantidade: 2 }]);
  });

  it("lead sem telefone entra na conta de bloqueados, não na de mensagens", () => {
    const resumo = resumirLote({
      leads: [lead(1, null), lead(2, "5515991280218")],
      cfg: CONFIG,
      ultimoContatoPorTelefone: new Map(),
      agora: AGORA,
    });

    expect(resumo.vao_sair).toBe(1);
    expect(resumo.bloqueados).toBe(1);
    expect(resumo.motivos[0].motivo).toMatch(/sem telefone/i);
  });

  it("remetente não configurado bloqueia tudo, é config do cliente", () => {
    const resumo = resumirLote({
      leads: [lead(1, "5515991280217")],
      cfg: { ...CONFIG, wts_from: "   " },
      ultimoContatoPorTelefone: new Map(),
      agora: AGORA,
    });

    expect(resumo.bloqueados).toBe(1);
    expect(resumo.motivos[0].motivo).toMatch(/remetente/i);
  });

  it("texto que some depois da substituição bloqueia, como no envio de um lead só", () => {
    const resumo = resumirLote({
      leads: [lead(1, "5515991280217", { nome: null, veiculo_texto: null })],
      cfg: { ...CONFIG, texto_boas_vindas: "{veiculo}" },
      ultimoContatoPorTelefone: new Map(),
      agora: AGORA,
    });

    expect(resumo.bloqueados).toBe(1);
    expect(resumo.motivos[0].motivo).toMatch(/texto/i);
  });

  it("telefone contatado dentro da janela conta como bloqueado antes de o lote começar", () => {
    const resumo = resumirLote({
      leads: [lead(1, "5515991280217"), lead(2, "5515991280218")],
      cfg: CONFIG,
      ultimoContatoPorTelefone: new Map([["5515991280217", "2026-09-10T12:00:00.000Z"]]),
      agora: AGORA,
    });

    expect(resumo.vao_sair).toBe(1);
    expect(resumo.bloqueados).toBe(1);
    expect(resumo.motivos[0].motivo).toMatch(/janela de 30d/);
  });

  it("lead que já recebeu mensagem deste app aparece como já enviado", () => {
    const resumo = resumirLote({
      leads: [lead(1, "5515991280217", { enviado_em: "2026-01-01T00:00:00.000Z" })],
      cfg: CONFIG,
      ultimoContatoPorTelefone: new Map(),
      agora: AGORA,
    });

    expect(resumo.bloqueados).toBe(1);
    expect(resumo.motivos[0].motivo).toMatch(/ja enviado/i);
  });

  it("agrupa os motivos, do mais frequente para o menos", () => {
    const resumo = resumirLote({
      leads: [lead(1, null), lead(2, null), lead(3, "5515991280217", { enviado_em: "2026-01-01T00:00:00.000Z" })],
      cfg: CONFIG,
      ultimoContatoPorTelefone: new Map(),
      agora: AGORA,
    });

    expect(resumo.motivos[0].quantidade).toBe(2);
    expect(resumo.motivos).toHaveLength(2);
  });

  it("seleção vazia não vira lote", () => {
    const resumo = resumirLote({
      leads: [],
      cfg: CONFIG,
      ultimoContatoPorTelefone: new Map(),
      agora: AGORA,
    });

    expect(resumo).toMatchObject({ vao_sair: 0, pessoas: 0, bloqueados: 0, motivos: [] });
  });
});

describe("os números do ritmo", () => {
  /**
   * O WTS aguenta ~500 chamadas a cada 5 minutos, e cada lead custa até
   * quatro (busca de contato, consulta de conversa, envio, conferência de
   * status). Com a pausa escolhida, o lote usa uma fração disso e deixa
   * folga para o cron e para os envios avulsos que acontecem ao mesmo tempo.
   */
  it("o ritmo escolhido fica bem abaixo do limite do WTS", () => {
    const enviosPor5Min = (5 * 60_000) / PAUSA_ENTRE_ENVIOS_MS;
    expect(enviosPor5Min * 4).toBeLessThan(500 / 2);
  });

  /** Uma fatia inteira tem que caber com folga nos 300s da function. */
  it("a fatia cabe no prazo da function, com margem", () => {
    expect(TETO_POR_REQUISICAO * PAUSA_ENTRE_ENVIOS_MS).toBeLessThan(PRAZO_REQUISICAO_MS);
    expect(PRAZO_REQUISICAO_MS).toBeLessThan(300_000);
  });

  /** O teto do lote precisa ser um número que um humano consegue vigiar. */
  it("o lote inteiro leva menos de vinte minutos", () => {
    expect((TETO_POR_LOTE * PAUSA_ENTRE_ENVIOS_MS) / 60_000).toBeLessThan(20);
  });
});
