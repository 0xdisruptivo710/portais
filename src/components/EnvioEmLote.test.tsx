import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EnvioEmLote from "./EnvioEmLote";

const PREVIA = {
  selecionados: 3,
  no_lote: 3,
  acima_do_teto: 0,
  teto: 60,
  ids: [1, 2, 3],
  vao_sair: 2,
  pessoas: 2,
  repetidos: 0,
  bloqueados: 1,
  motivos: [{ motivo: "sem telefone normalizavel", quantidade: 1 }],
  pausa_segundos: 12,
  janela: { aberta: true, inicio: "08:00", fim: "20:00" },
  conversa_wts_confere_no_envio: true,
};

function enviado(leadId: number) {
  return {
    lead_id: leadId,
    situacao: "enviado",
    motivo: null,
    verificado: false,
    verificacao_detalhe: "status QUEUED (id msg-1)",
  };
}

/**
 * Roteia prévia e envio, e deixa o teste dizer o que cada chamada de envio
 * devolve. O lote é uma emenda de requisições: sem controlar uma a uma, não
 * dá para testar nem a retomada nem a interrupção.
 */
function mockarLote(previa: unknown, fatias: unknown[]) {
  let proxima = 0;
  // `init` entra na assinatura porque o teste da emenda confere o corpo de
  // cada chamada: sem ele, a tupla do mock nao tem o segundo argumento.
  const f = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "/api/lote/previa") {
      return { ok: true, status: 200, json: async () => previa };
    }
    const fatia = fatias[Math.min(proxima, fatias.length - 1)];
    proxima++;
    return { ok: true, status: 200, json: async () => fatia };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

/**
 * O numero fica num elemento e o rotulo em outro (o numero e' grande, o rotulo
 * nao), entao a frase inteira so' existe no textContent do pai. Este e' o
 * caminho que a propria testing-library recomenda para texto quebrado entre
 * elementos: casa no elemento mais interno que contem a frase.
 */
function frase(padrao: RegExp): HTMLElement {
  return screen.getByText((_conteudo, elemento) => {
    if (!elemento) return false;
    if (!padrao.test(elemento.textContent ?? "")) return false;
    return !Array.from(elemento.children).some((filho) => padrao.test(filho.textContent ?? ""));
  });
}

function montar(props: Partial<React.ComponentProps<typeof EnvioEmLote>> = {}) {
  return render(
    <EnvioEmLote
      ids={[1, 2, 3]}
      descricaoFiltro="Vendedor Beatryz"
      aoResultado={props.aoResultado ?? (() => {})}
      aoLimparSelecao={props.aoLimparSelecao ?? (() => {})}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("envio em lote: nada sai sem confirmação", () => {
  it("na montagem não chama a API nem manda mensagem nenhuma", () => {
    const f = mockarLote(PREVIA, []);
    montar();
    expect(f).not.toHaveBeenCalled();
  });

  it("mostra quantos estão selecionados", () => {
    mockarLote(PREVIA, []);
    montar();
    expect(screen.getByText(/3 selecionados/i)).toBeInTheDocument();
  });

  /**
   * "Tem certeza?" não serve para dezenas de mensagens sem desfazer. O que
   * serve é o número: quantas saem, para quantas pessoas e quantas já estão
   * bloqueadas.
   */
  it("a confirmação obriga a olhar o número: mensagens, pessoas e bloqueados", async () => {
    mockarLote(PREVIA, []);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));

    expect(await screen.findByRole("button", { name: /confirmar envio de 2 mensagens/i })).toBeInTheDocument();
    expect(frase(/2 mensagens v[ãa]o sair/i)).toBeInTheDocument();
    expect(frase(/2 pessoas distintas/i)).toBeInTheDocument();
    expect(frase(/1 j[áa] est[áa] bloqueado/i)).toBeInTheDocument();
    expect(screen.getByText(/sem telefone normalizavel/i)).toBeInTheDocument();
  });

  /** "Todos" quer dizer o que o filtro mostra, e isso não pode ficar implícito. */
  it("a confirmação diz, em palavras, qual filtro está valendo", async () => {
    mockarLote(PREVIA, []);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));

    expect(await screen.findByText(/vendedor beatryz/i)).toBeInTheDocument();
  });

  it("a confirmação mostra o ritmo e quantos ficam para o próximo lote", async () => {
    mockarLote({ ...PREVIA, selecionados: 217, no_lote: 60, acima_do_teto: 157, vao_sair: 58 }, []);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));

    expect(await screen.findByText(/157/)).toBeInTheDocument();
    expect(screen.getByText(/12 segundos/i)).toBeInTheDocument();
  });

  /** A prévia não consulta o WTS: isso precisa estar escrito, não subentendido. */
  it("a confirmação avisa que a conversa aberta no WTS só é conferida no envio", async () => {
    mockarLote(PREVIA, []);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));

    expect(await screen.findByText(/conversa.*wts/i)).toBeInTheDocument();
  });

  it("cancelar fecha a confirmação sem enviar nada", async () => {
    const f = mockarLote(PREVIA, []);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await screen.findByRole("button", { name: /confirmar envio/i });
    await userEvent.click(screen.getByRole("button", { name: /cancelar/i }));

    expect(f.mock.calls.filter((c) => c[0] === "/api/lote/enviar")).toHaveLength(0);
  });
});

describe("envio em lote: as fatias emendam", () => {
  it("continua chamando enquanto sobrar gente, e manda os restantes que o servidor devolveu", async () => {
    const f = mockarLote(PREVIA, [
      { resultados: [enviado(1), enviado(2)], restantes: [3], parado: "fatia" },
      { resultados: [enviado(3)], restantes: [], parado: null },
    ]);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    await screen.findByText(/lote conclu[íi]do/i);
    const envios = f.mock.calls.filter((c) => c[0] === "/api/lote/enviar");
    expect(envios).toHaveLength(2);
    expect(JSON.parse(String((envios[0][1] as RequestInit).body))).toEqual({ leadIds: [1, 2, 3] });
    expect(JSON.parse(String((envios[1][1] as RequestInit).body))).toEqual({ leadIds: [3] });
  });

  it("o progresso conta o que já saiu enquanto o lote ainda corre", async () => {
    // A segunda fatia fica presa: e' o unico jeito de olhar a tela com o lote
    // em andamento, que e' exatamente o que o operador ve' durante os minutos
    // de envio.
    let liberar: (() => void) | null = null;
    let chamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/lote/previa") return { ok: true, status: 200, json: async () => PREVIA };
        chamadas++;
        if (chamadas === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ resultados: [enviado(1), enviado(2)], restantes: [3], parado: "fatia" }),
          };
        }
        await new Promise<void>((resolver) => {
          liberar = resolver;
        });
        return { ok: true, status: 200, json: async () => ({ resultados: [enviado(3)], restantes: [], parado: null }) };
      }),
    );
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/2 de 3 processados/i)).toBeInTheDocument();
    await waitFor(() => expect(liberar).not.toBeNull());
    (liberar as unknown as () => void)();
    expect(await screen.findByText(/lote conclu[íi]do/i)).toBeInTheDocument();
  });

  it("avisa a linha da lista sobre cada lead, para a tabela refletir o envio", async () => {
    const aoResultado = vi.fn();
    mockarLote(PREVIA, [
      {
        resultados: [
          enviado(1),
          { lead_id: 2, situacao: "bloqueado", motivo: "ja existe conversa no WTS", verificado: false, verificacao_detalhe: null },
        ],
        restantes: [],
        parado: null,
      },
    ]);
    montar({ aoResultado });

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    await screen.findByText(/lote conclu[íi]do/i);
    expect(aoResultado).toHaveBeenCalledWith(1, "enviado");
    expect(aoResultado).toHaveBeenCalledWith(2, "bloqueado");
  });
});

describe("envio em lote: o operador consegue parar", () => {
  it("parar interrompe entre as fatias, sem pedir a próxima", async () => {
    let liberar: (() => void) | null = null;
    const f = vi.fn(async (url: string) => {
      if (url === "/api/lote/previa") return { ok: true, status: 200, json: async () => PREVIA };
      await new Promise<void>((resolver) => {
        liberar = resolver;
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ resultados: [enviado(1)], restantes: [2, 3], parado: "fatia" }),
      };
    });
    vi.stubGlobal("fetch", f);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));
    await waitFor(() => expect(liberar).not.toBeNull());

    // Parar no meio da fatia em curso: a fatia termina (as mensagens dela já
    // estão a caminho), e a próxima não é pedida.
    await userEvent.click(screen.getByRole("button", { name: /^parar$/i }));
    (liberar as unknown as () => void)();

    await screen.findByText(/interrompido por voc[êe]/i);
    expect(f.mock.calls.filter((c) => c[0] === "/api/lote/enviar")).toHaveLength(1);
    expect(screen.getByText(/2 ficaram de fora/i)).toBeInTheDocument();
  });
});

describe("envio em lote: o resultado diz a verdade", () => {
  it("mensagem enviada não vira entrega confirmada", async () => {
    mockarLote(PREVIA, [{ resultados: [enviado(1)], restantes: [], parado: null }]);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    await screen.findByText(/lote conclu[íi]do/i);
    // Aparece no resumo e na linha do lead: as duas frases dizem a mesma
    // coisa, e nenhuma delas pode virar "entregue".
    expect(screen.getAllByText(/entrega.*n[ãa]o confirmada/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/entrega confirmada/i)).not.toBeInTheDocument();
  });

  it("bloqueado aparece com o motivo, e falhou com o erro", async () => {
    mockarLote(PREVIA, [
      {
        resultados: [
          { lead_id: 1, situacao: "bloqueado", motivo: "kill-switch ligado", verificado: false, verificacao_detalhe: null },
          { lead_id: 2, situacao: "falhou", motivo: "WTS POST 502", verificado: false, verificacao_detalhe: null },
        ],
        restantes: [],
        parado: null,
      },
    ]);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    await screen.findByText(/lote conclu[íi]do/i);
    expect(screen.getByText(/kill-switch ligado/i)).toBeInTheDocument();
    expect(screen.getByText(/WTS POST 502/i)).toBeInTheDocument();
  });

  it("fora da janela de horário o lote nem começa, e explica por quê", async () => {
    mockarLote(PREVIA, [{ resultados: [], restantes: [1, 2, 3], parado: "fora_da_janela" }]);
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/fora do hor[áa]rio/i)).toBeInTheDocument();
  });

  /**
   * Requisição que morre no meio não pode perder o resto do lote: os ids que
   * faltam continuam na tela, e retomar não repete quem já recebeu (quem
   * garante isso é o estado do lead, no servidor).
   */
  it("erro de rede guarda os restantes e oferece retomar", async () => {
    let chamadas = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/lote/previa") return { ok: true, status: 200, json: async () => PREVIA };
        chamadas++;
        if (chamadas === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ resultados: [enviado(1)], restantes: [2, 3], parado: "fatia" }),
          };
        }
        return { ok: false, status: 500, json: async () => ({ erro: "banco fora do ar" }) };
      }),
    );
    montar();

    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await screen.findByText(/banco fora do ar/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retomar/i })).toBeInTheDocument();
    expect(screen.getByText(/2 ficaram de fora/i)).toBeInTheDocument();
  });
});
