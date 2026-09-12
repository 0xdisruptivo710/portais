import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BotaoEnviar from "./BotaoEnviar";

const PREVIA = {
  texto: "Oi Fulano, tudo bem? Vi seu interesse no Civic 2020.",
  telefone_exibicao: "+55 (15) 99128-0217",
  para: "+55|15991280217",
  bloqueado: false,
  motivo: null,
  ultimo_contato_em: null,
  dias_desde_ultimo_contato: null,
};

const ENVIADO = {
  acao: "enviar",
  enviado: true,
  motivo: null,
  resposta_wts: { id: "msg-1", status: "QUEUED" },
  verificado: false,
  verificacao_detalhe: "status QUEUED (id msg-1): saiu do gateway, entrega ao destinatario nao comprovada",
};

/**
 * Roteia por método: o GET é a prévia que a tela mostra antes de confirmar, e
 * o POST é o disparo de verdade. Separar os dois é o que permite provar que
 * abrir a confirmação não manda mensagem nenhuma.
 */
function mockarApi(previa: unknown = PREVIA, envio: unknown = ENVIADO) {
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    const corpo = init?.method === "POST" ? envio : previa;
    return { ok: true, status: 200, json: async () => corpo };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function chamadasPost(f: ReturnType<typeof vi.fn>): unknown[] {
  return f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");
}

beforeEach(() => vi.unstubAllGlobals());

describe("botao de envio de um lead", () => {
  it("abrir a confirmacao busca a previa e NAO envia nada", async () => {
    const f = mockarApi();
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));

    expect(await screen.findByRole("heading", { name: /confirmar envio/i })).toBeInTheDocument();
    expect(f).toHaveBeenCalledWith("/api/enviar?leadId=7");
    expect(chamadasPost(f)).toHaveLength(0);
  });

  // O operador precisa ver a mensagem antes, nunca depois.
  it("mostra o texto exato e o numero de destino antes de confirmar", async () => {
    mockarApi();
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));

    expect(await screen.findByText(PREVIA.texto)).toBeInTheDocument();
    expect(screen.getByText(/\+55 \(15\) 99128-0217/)).toBeInTheDocument();
  });

  // 13% da base tem telefone repetido: o operador tem que ver isso ANTES.
  it("avisa, em destaque, quando o telefone ja recebeu mensagem", async () => {
    mockarApi({ ...PREVIA, ultimo_contato_em: "2026-09-07T16:00:00Z", dias_desde_ultimo_contato: 3 });
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/já recebeu mensagem/i);
    expect(aviso).toHaveTextContent(/3 dias/);
  });

  it("mostra o bloqueio com o motivo quando o envio vai ser suprimido", async () => {
    mockarApi({ ...PREVIA, bloqueado: true, motivo: "contatado ha 3d, janela de 30d" });
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /enviar/i }));

    expect(await screen.findByText(/contatado ha 3d, janela de 30d/)).toBeInTheDocument();
  });

  it("cancelar fecha a confirmacao sem enviar", async () => {
    const f = mockarApi();
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await screen.findByRole("heading", { name: /confirmar envio/i });
    await userEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(screen.queryByRole("heading", { name: /confirmar envio/i })).not.toBeInTheDocument();
    expect(chamadasPost(f)).toHaveLength(0);
  });

  it("confirmar dispara o POST uma vez e avisa o pai do novo status", async () => {
    const f = mockarApi();
    const aoEnviar = vi.fn();
    render(<BotaoEnviar leadId={7} aoEnviar={aoEnviar} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/mensagem enviada/i)).toBeInTheDocument();
    expect(chamadasPost(f)).toHaveLength(1);
    expect(aoEnviar).toHaveBeenCalledWith("enviado");
  });

  // A cicatriz do QUEUED: a tela não pode dizer "entregue" com base no
  // retorno do POST.
  it("nao afirma entrega quando a conferencia nao confirmou", async () => {
    mockarApi();
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/entrega ainda não confirmada/i)).toBeInTheDocument();
    expect(screen.queryByText(/entrega confirmada:/i)).not.toBeInTheDocument();
  });

  it("afirma a entrega so quando a conferencia confirmou", async () => {
    mockarApi(PREVIA, {
      ...ENVIADO,
      verificado: true,
      verificacao_detalhe: "status DELIVERED confirmado na consulta (id msg-1)",
    });
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/entrega confirmada/i)).toBeInTheDocument();
  });

  it("supressao no POST aparece com o motivo, e o pai recebe o status suprimido", async () => {
    const aoEnviar = vi.fn();
    mockarApi(PREVIA, {
      acao: "suprimido",
      enviado: false,
      motivo: "kill-switch ligado",
      resposta_wts: null,
      verificado: false,
      verificacao_detalhe: null,
    });
    render(<BotaoEnviar leadId={7} aoEnviar={aoEnviar} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/kill-switch ligado/)).toBeInTheDocument();
    expect(aoEnviar).toHaveBeenCalledWith("suprimido");
  });

  it("erro do servidor aparece na tela, sem avisar o pai de nada", async () => {
    const aoEnviar = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: false, status: 502, json: async () => ({ erro: "WTS POST 422: numero invalido" }) };
        }
        return { ok: true, status: 200, json: async () => PREVIA };
      }),
    );
    render(<BotaoEnviar leadId={7} aoEnviar={aoEnviar} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/422/)).toBeInTheDocument();
    expect(aoEnviar).not.toHaveBeenCalled();
  });

  it("falha ao carregar a previa nao abre a confirmacao", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ erro: "lead nao encontrado" }) })),
    );
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    expect(await screen.findByText(/lead nao encontrado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirmar envio/i })).not.toBeInTheDocument();
  });
});

/**
 * O operador não vê a conversa do WTS nesta tela. Quando o servidor bloqueia
 * por conversa aberta, é o motivo dele que transforma o clique seguinte numa
 * decisão informada, em vez de uma aposta no escuro.
 */
const BLOQUEADO_POR_CONVERSA = {
  acao: "suprimido",
  enviado: false,
  motivo: "ja existe conversa no WTS, ultima mensagem ha 2h",
  resposta_wts: null,
  verificado: false,
  verificacao_detalhe: null,
  pode_forcar: true,
};

function corpoDoPost(f: ReturnType<typeof vi.fn>, indice: number): Record<string, unknown> {
  const chamada = f.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST")[indice];
  return JSON.parse(String((chamada[1] as RequestInit).body));
}

describe("botao de envio: conversa ja aberta no WTS", () => {
  it("mostra o motivo com a idade da ultima mensagem", async () => {
    mockarApi(PREVIA, BLOQUEADO_POR_CONVERSA);
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/ja existe conversa no WTS, ultima mensagem ha 2h/)).toBeInTheDocument();
  });

  it("o primeiro clique NAO manda mensagem: ele so traz o motivo", async () => {
    const f = mockarApi(PREVIA, BLOQUEADO_POR_CONVERSA);
    const aoEnviar = vi.fn();
    render(<BotaoEnviar leadId={7} aoEnviar={aoEnviar} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(chamadasPost(f)).toHaveLength(1);
    expect(corpoDoPost(f, 0).forcar).toBeUndefined();
    expect(aoEnviar).toHaveBeenCalledWith("suprimido");
  });

  it("oferece enviar mesmo assim, e o segundo clique manda forcar", async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return { ok: true, status: 200, json: async () => PREVIA };
      const corpo = JSON.parse(String(init.body)) as { forcar?: boolean };
      return {
        ok: true,
        status: 200,
        json: async () => (corpo.forcar ? ENVIADO : BLOQUEADO_POR_CONVERSA),
      };
    });
    vi.stubGlobal("fetch", f);
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));
    await userEvent.click(await screen.findByRole("button", { name: /enviar mesmo assim/i }));

    expect(await screen.findByText(/mensagem enviada/i)).toBeInTheDocument();
    expect(chamadasPost(f)).toHaveLength(2);
    expect(corpoDoPost(f, 1).forcar).toBe(true);
  });

  // Falha de consulta ao WTS bloqueia igual, mas não vem com pode_forcar: não
  // existe atalho para mandar sem saber se há negociação em andamento.
  it("nao oferece saida quando o servidor nao conseguiu conferir", async () => {
    mockarApi(PREVIA, {
      ...BLOQUEADO_POR_CONVERSA,
      motivo: "nao foi possivel conferir conversa no WTS: WTS GET 503",
      pode_forcar: false,
    });
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/nao foi possivel conferir conversa no WTS/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enviar mesmo assim/i })).not.toBeInTheDocument();
  });

  it("supressao comum (kill-switch) continua sem oferecer saida", async () => {
    mockarApi(PREVIA, {
      acao: "suprimido",
      enviado: false,
      motivo: "kill-switch ligado",
      resposta_wts: null,
      verificado: false,
      verificacao_detalhe: null,
      pode_forcar: false,
    });
    render(<BotaoEnviar leadId={7} aoEnviar={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/kill-switch ligado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enviar mesmo assim/i })).not.toBeInTheDocument();
  });
});
