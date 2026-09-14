import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Leads from "./Leads";

describe("tela de leads", () => {
  it("mostra o estado vazio sem parecer erro", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itens: [] }) }));
    render(<Leads />);
    expect(await screen.findByText(/nenhum lead/i)).toBeInTheDocument();
  });

  it("lista o lead com portal e veículo", async () => {
    // Roteia por URL: a tela tambem pede /api/vendedores, e devolver a lista
    // de leads ali encheria o seletor com nome de lead.
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.startsWith("/api/leads")
          ? { itens: [{ id: 1, portal: "webmotors", nome: "Fulano", veiculo_texto: "Civic 2020", telefone_exibicao: "+55 (15) 99128-0217", status_ativacao: "dry_run" }] }
          : { itens: [] },
    })));
    render(<Leads />);
    expect(await screen.findByText("Fulano")).toBeInTheDocument();
    expect(screen.getByText(/civic 2020/i)).toBeInTheDocument();
  });

  it("busca sem filtro de portal na carga inicial", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itens: [] }) });
    vi.stubGlobal("fetch", f);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);
    expect(f).toHaveBeenCalledWith("/api/leads");
  });

  // O endpoint /api/leads já aceita ?portal= nativamente (ver api/leads.ts);
  // filtrar em memória sobre os 50 mais recentes escondia leads de um portal
  // que não estivessem nessa primeira página. O filtro tem que ir pra query.
  it("trocar o filtro de portal refaz a busca no servidor, com ?portal=", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itens: [] }) });
    vi.stubGlobal("fetch", f);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);
    f.mockClear();

    await userEvent.selectOptions(screen.getByLabelText(/portal/i), "webmotors");

    expect(f).toHaveBeenCalledWith("/api/leads?portal=webmotors");
  });

  it("voltar o filtro para 'Todos' refaz a busca sem o query param", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ itens: [] }) });
    vi.stubGlobal("fetch", f);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);

    await userEvent.selectOptions(screen.getByLabelText(/portal/i), "webmotors");
    f.mockClear();
    await userEvent.selectOptions(screen.getByLabelText(/portal/i), "");

    expect(f).toHaveBeenCalledWith("/api/leads");
  });
});

const VENDEDORES = [
  { id: 1, nome: "Murilo", ordem: 1 },
  { id: 2, nome: "Beatryz", ordem: 2 },
  { id: 3, nome: "Vinicius", ordem: 3 },
];

const LEAD_COM_TELEFONE = {
  id: 1,
  portal: "webmotors",
  nome: "Fulano",
  veiculo_texto: "Civic 2020",
  telefone_e164: "5515991280217",
  telefone_exibicao: "+55 (15) 99128-0217",
  status_ativacao: "dry_run",
};

const PREVIA = {
  texto: "Oi Fulano, tudo bem? Vi seu interesse no Civic 2020.",
  telefone_exibicao: "+55 (15) 99128-0217",
  para: "+55|15991280217",
  bloqueado: false,
  motivo: null,
  ultimo_contato_em: null,
  dias_desde_ultimo_contato: null,
};

/**
 * Roteia por URL e por método: a lista, a prévia do envio e o disparo são
 * três chamadas diferentes, e o teste de "a linha reflete o novo estado"
 * depende de as três serem distinguíveis.
 */
function mockarApiDeLeads(itens: unknown[], envio: unknown) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/leads")) {
      return { ok: true, status: 200, json: async () => ({ itens }) };
    }
    if (url.startsWith("/api/vendedores")) {
      return { ok: true, status: 200, json: async () => ({ itens: VENDEDORES }) };
    }
    if (url.startsWith("/api/revisao")) {
      return { ok: true, status: 200, json: async () => ({ itens: [] }) };
    }
    if (init?.method === "POST") return { ok: true, status: 200, json: async () => envio };
    return { ok: true, status: 200, json: async () => PREVIA };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("tela de leads: botao de envio por linha", () => {
  it("lead com telefone ganha o botao de enviar", async () => {
    mockarApiDeLeads([LEAD_COM_TELEFONE], null);
    render(<Leads />);

    await screen.findByText("Fulano");
    expect(screen.getByRole("button", { name: /^enviar$/i })).toBeInTheDocument();
  });

  // OLX e Mercado Livre não entregam telefone no e-mail: esses leads não têm
  // para onde enviar, e um botão ali só produziria erro.
  it("lead sem telefone nao ganha botao nenhum", async () => {
    mockarApiDeLeads([{ ...LEAD_COM_TELEFONE, telefone_e164: null, telefone_exibicao: null }], null);
    render(<Leads />);

    await screen.findByText("Fulano");
    expect(screen.queryByRole("button", { name: /^enviar$/i })).not.toBeInTheDocument();
  });

  it("depois do envio a linha mostra o novo status, sem recarregar a pagina", async () => {
    const f = mockarApiDeLeads([LEAD_COM_TELEFONE], {
      acao: "enviar",
      enviado: true,
      motivo: null,
      resposta_wts: { id: "msg-1" },
      verificado: false,
      verificacao_detalhe: "status QUEUED (id msg-1)",
    });
    render(<Leads />);

    await screen.findByText("Fulano");
    // A busca é presa à tabela: "Simulado" e "Enviado" também são rótulos das
    // opções do filtro de status, e procurar na tela inteira acharia os dois.
    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText("Simulado")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    expect(await within(tabela).findByText("Enviado")).toBeInTheDocument();
    expect(within(tabela).queryByText("Simulado")).not.toBeInTheDocument();
    // A lista não é refeita: o estado novo veio da resposta do envio.
    expect(f.mock.calls.filter((c) => String(c[0]).startsWith("/api/leads"))).toHaveLength(1);
  });
});

/**
 * O caso de uso e' o vendedor abrir o app e ver so' o que e' dele. Por isso o
 * filtro vai pro servidor, como o de portal: filtrar em memoria sobre os 50
 * mais recentes esconderia o lead dele que nao coubesse nessa pagina.
 */
describe("tela de leads: filtro por vendedor", () => {
  it("monta o seletor com os vendedores ativos, mais Todos", async () => {
    mockarApiDeLeads([], null);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);

    const seletor = screen.getByLabelText(/vendedor/i);
    const rotulos = within(seletor).getAllByRole("option").map((o) => o.textContent);
    expect(rotulos).toEqual(["Todos", "Murilo", "Beatryz", "Vinicius"]);
  });

  it("trocar o vendedor refaz a busca no servidor, com ?vendedor=", async () => {
    const f = mockarApiDeLeads([], null);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);
    f.mockClear();

    await userEvent.selectOptions(screen.getByLabelText(/vendedor/i), "Beatryz");

    expect(f).toHaveBeenCalledWith("/api/leads?vendedor=Beatryz");
  });

  it("portal e vendedor juntos vao os dois na query", async () => {
    const f = mockarApiDeLeads([], null);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);

    await userEvent.selectOptions(screen.getByLabelText(/portal/i), "webmotors");
    f.mockClear();
    await userEvent.selectOptions(screen.getByLabelText(/vendedor/i), "Murilo");

    expect(f).toHaveBeenCalledWith("/api/leads?portal=webmotors&vendedor=Murilo");
  });

  it("voltar para Todos refaz a busca sem o query param", async () => {
    const f = mockarApiDeLeads([], null);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);

    await userEvent.selectOptions(screen.getByLabelText(/vendedor/i), "Murilo");
    f.mockClear();
    await userEvent.selectOptions(screen.getByLabelText(/vendedor/i), "");

    expect(f).toHaveBeenCalledWith("/api/leads");
  });

  // Sem a coluna, o filtro seria a unica forma de saber de quem e' o lead, e
  // a lista com "Todos" nao diria nada sobre a divisao do trabalho.
  it("a linha mostra de quem e' o lead", async () => {
    mockarApiDeLeads([{ ...LEAD_COM_TELEFONE, vendedor: "Vinicius" }], null);
    render(<Leads />);

    await screen.findByText("Fulano");
    expect(within(screen.getByRole("table")).getByText("Vinicius")).toBeInTheDocument();
  });

  it("lead ainda sem dono aparece como sem vendedor, nao como linha em branco", async () => {
    mockarApiDeLeads([{ ...LEAD_COM_TELEFONE, vendedor: null }], null);
    render(<Leads />);

    await screen.findByText("Fulano");
    expect(within(screen.getByRole("table")).getByText(/sem vendedor/i)).toBeInTheDocument();
  });

  // A lista de vendedores nao pode derrubar a tela: sem ela o seletor fica
  // so' com "Todos" e os leads continuam aparecendo.
  it("falha ao listar vendedores nao impede a lista de leads de carregar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/vendedores")) return { ok: false, status: 500, json: async () => ({ erro: "boom" }) };
        return { ok: true, status: 200, json: async () => ({ itens: [LEAD_COM_TELEFONE] }) };
      }),
    );
    render(<Leads />);

    expect(await screen.findByText("Fulano")).toBeInTheDocument();
    const seletor = screen.getByLabelText(/vendedor/i);
    expect(within(seletor).getAllByRole("option")).toHaveLength(1);
  });
});

const EVENTO_REVISAO = {
  id: 9,
  portal: "comprecar",
  assunto: "Contato do anuncio 4471",
  remetente: "leads@comprecar.com.br",
  recebido_em: "2026-09-11T10:00:00Z",
  corpo_texto: "corpo em texto",
  corpo_html: "<p>corpo</p>",
};

/**
 * Roteia leads, vendedores e a fila de revisao. A aba Revisao saiu da
 * navegacao, mas a fila continua existindo dentro desta lista: e' a rede de
 * seguranca que faz "perder lead" ser impossivel por construcao.
 */
function mockarApiCompleta(leads: unknown[], revisao: unknown[]) {
  // A fila do servidor e' estado, nao constante: completar uma revisao tira o
  // evento de la'. Sem isso o mock devolveria o item completado de volta na
  // releitura e esconderia se a tela esta' certa ou errada.
  let fila = [...revisao] as { id: number }[];
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/vendedores")) {
      return { ok: true, status: 200, json: async () => ({ itens: VENDEDORES }) };
    }
    if (url.startsWith("/api/revisao")) {
      if (init?.method === "POST") {
        const corpo = JSON.parse(String(init.body)) as { evento_id: number };
        fila = fila.filter((evento) => evento.id !== corpo.evento_id);
        return { ok: true, status: 201, json: async () => ({ id: 77 }) };
      }
      return { ok: true, status: 200, json: async () => ({ itens: fila }) };
    }
    // A tela confere o atendimento dos leads visiveis assim que a lista
    // chega. Quem nao esta' testando isso recebe resposta vazia, e nenhuma
    // linha ganha selo de atendimento.
    if (url.startsWith("/api/conversas")) {
      return { ok: true, status: 200, json: async () => ({ itens: [], consultados: 0 }) };
    }
    return { ok: true, status: 200, json: async () => ({ itens: leads }) };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("tela de leads: a fila de revisao mora aqui", () => {
  it("item que nem o parser nem a IA leram aparece na lista, com status proprio", async () => {
    mockarApiCompleta([], [EVENTO_REVISAO]);
    render(<Leads />);

    const tabela = await screen.findByRole("table");
    expect(within(tabela).getByText(/contato do anuncio 4471/i)).toBeInTheDocument();
    expect(within(tabela).getByText(/precisa revis/i)).toBeInTheDocument();
  });

  // O selo vermelho saiu da aba junto com a aba. Sem um lugar que conte, a
  // fila de seguranca fica invisivel ate' alguem pensar em procurar por ela.
  it("um aviso no topo diz quantos estao esperando revisao", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE], [EVENTO_REVISAO, { ...EVENTO_REVISAO, id: 10 }]);
    render(<Leads />);

    expect(await screen.findByText(/2 leads precisam de revis/i)).toBeInTheDocument();
  });

  it("sem nada na fila, nao existe aviso nenhum", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE], []);
    render(<Leads />);

    await screen.findByText("Fulano");
    expect(screen.queryByText(/precisam de revis/i)).not.toBeInTheDocument();
  });

  it("o filtro de status isola quem precisa de revisao", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE], [EVENTO_REVISAO]);
    render(<Leads />);
    await screen.findByText("Fulano");

    await userEvent.selectOptions(screen.getByLabelText(/^status$/i), "revisao");

    const tabela = screen.getByRole("table");
    expect(within(tabela).getByText(/contato do anuncio 4471/i)).toBeInTheDocument();
    expect(within(tabela).queryByText("Fulano")).not.toBeInTheDocument();
  });

  it("o aviso leva direto para eles", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE], [EVENTO_REVISAO]);
    render(<Leads />);

    await userEvent.click(await screen.findByRole("button", { name: /ver os que precisam de revis/i }));

    const tabela = screen.getByRole("table");
    expect(within(tabela).queryByText("Fulano")).not.toBeInTheDocument();
    expect(within(tabela).getByText(/contato do anuncio 4471/i)).toBeInTheDocument();
  });

  it("a linha abre com o e-mail original isolado e o formulario de completar", async () => {
    mockarApiCompleta([], [EVENTO_REVISAO]);
    const { container } = render(<Leads />);
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: /revisar/i }));

    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(screen.getByRole("button", { name: /completar revis/i })).toBeInTheDocument();
  });

  it("completar a revisao tira a linha da fila e recarrega a lista de leads", async () => {
    const f = mockarApiCompleta([], [EVENTO_REVISAO]);
    render(<Leads />);
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: /revisar/i }));
    const chamadasAntes = f.mock.calls.filter((c) => String(c[0]).startsWith("/api/leads")).length;

    await userEvent.click(screen.getByRole("button", { name: /completar revis/i }));

    await waitFor(() => expect(screen.queryByText(/contato do anuncio 4471/i)).not.toBeInTheDocument());
    // O lead corrigido acabou de nascer no banco: a lista precisa ir buscar.
    await waitFor(() =>
      expect(f.mock.calls.filter((c) => String(c[0]).startsWith("/api/leads")).length).toBeGreaterThan(
        chamadasAntes,
      ),
    );
  });

  // Item de revisao ainda nao e' lead: nao tem dono. Filtrar por vendedor
  // esconde a linha, e por isso o aviso continua contando a fila inteira.
  it("com filtro de vendedor a linha some, mas o aviso continua contando", async () => {
    mockarApiCompleta([], [EVENTO_REVISAO]);
    render(<Leads />);
    await screen.findByRole("table");

    await userEvent.selectOptions(screen.getByLabelText(/vendedor/i), "Beatryz");

    expect(screen.queryByText(/contato do anuncio 4471/i)).not.toBeInTheDocument();
    expect(screen.getByText(/1 lead precisa de revis/i)).toBeInTheDocument();
  });

  // A fila e' acessorio da lista: se ela falhar, os leads continuam na tela.
  it("falha ao ler a fila de revisao nao derruba a lista de leads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/revisao")) return { ok: false, status: 500, json: async () => ({ erro: "boom" }) };
        if (url.startsWith("/api/vendedores")) return { ok: true, status: 200, json: async () => ({ itens: VENDEDORES }) };
        return { ok: true, status: 200, json: async () => ({ itens: [LEAD_COM_TELEFONE] }) };
      }),
    );
    render(<Leads />);

    expect(await screen.findByText("Fulano")).toBeInTheDocument();
  });
});

const OUTRO_LEAD = {
  id: 2,
  portal: "comprecar",
  nome: "Sicrano",
  veiculo_texto: "Onix 2019",
  telefone_e164: "5515991280218",
  telefone_exibicao: "+55 (15) 99128-0218",
  status_ativacao: "pendente",
  vendedor: "Beatryz",
};

const SEM_TELEFONE = {
  id: 3,
  portal: "olx",
  nome: "Beltrano",
  veiculo_texto: null,
  telefone_e164: null,
  telefone_exibicao: null,
  status_ativacao: "pendente",
  vendedor: "Murilo",
};

/**
 * O envio em lote e' o caminho mais perigoso do painel: um clique errado sao'
 * dezenas de mensagens para clientes reais. A selecao e' a base de tudo, e
 * "todos" tem que querer dizer o que o filtro mostra, nunca a base inteira.
 */
describe("tela de leads: selecao para o envio em lote", () => {
  it("so' quem tem telefone ganha caixa de marcar", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE, OUTRO_LEAD, SEM_TELEFONE], [EVENTO_REVISAO]);
    render(<Leads />);
    await screen.findByText("Fulano");

    const tabela = screen.getByRole("table");
    expect(within(tabela).getByLabelText(/selecionar lead 1/i)).toBeInTheDocument();
    expect(within(tabela).getByLabelText(/selecionar lead 2/i)).toBeInTheDocument();
    // Lead sem telefone nao tem para onde enviar, e item de revisao ainda nem
    // e' lead: marcar qualquer um dos dois so' produziria erro.
    expect(within(tabela).queryByLabelText(/selecionar lead 3/i)).not.toBeInTheDocument();
    expect(within(tabela).queryByLabelText(/selecionar lead 9/i)).not.toBeInTheDocument();
  });

  it("marcar uma linha abre a barra do lote com a contagem", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE, OUTRO_LEAD], []);
    render(<Leads />);
    await screen.findByText("Fulano");

    await userEvent.click(screen.getByLabelText(/selecionar lead 1/i));

    expect(screen.getByText(/1 selecionado/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enviar para os selecionados/i })).toBeInTheDocument();
  });

  it("selecionar todos os visiveis marca o que o filtro mostra, e so' isso", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE, OUTRO_LEAD, SEM_TELEFONE], []);
    render(<Leads />);
    await screen.findByText("Fulano");

    await userEvent.click(screen.getByLabelText(/selecionar todos os vis/i));

    // Tres leads na tela, dois com telefone.
    expect(screen.getByText(/2 selecionados/i)).toBeInTheDocument();
  });

  /**
   * O filtro e' quem define o conjunto. Uma selecao feita sobre outra lista,
   * carregada para um filtro novo, e' o caminho mais curto para mandar
   * mensagem para quem o operador nao esta' vendo.
   */
  it("trocar o filtro limpa a selecao", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE, OUTRO_LEAD], []);
    render(<Leads />);
    await screen.findByText("Fulano");
    await userEvent.click(screen.getByLabelText(/selecionar todos os vis/i));
    expect(screen.getByText(/2 selecionados/i)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/vendedor/i), "Beatryz");

    expect(screen.queryByText(/selecionado/i)).not.toBeInTheDocument();
  });

  it("a barra diz de qual filtro veio a selecao, em palavras", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE, OUTRO_LEAD], []);
    render(<Leads />);
    await screen.findByText("Fulano");

    await userEvent.selectOptions(screen.getByLabelText(/vendedor/i), "Beatryz");
    await screen.findByText("Fulano");
    await userEvent.click(screen.getByLabelText(/selecionar todos os vis/i));

    expect(screen.getByText(/vendedor beatryz/i)).toBeInTheDocument();
  });

  it("sem filtro nenhum, a barra deixa claro que sao todos os leads da lista", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE], []);
    render(<Leads />);
    await screen.findByText("Fulano");

    await userEvent.click(screen.getByLabelText(/selecionar todos os vis/i));

    expect(screen.getByText(/todos os leads da lista/i)).toBeInTheDocument();
  });

  it("limpar selecao fecha a barra", async () => {
    mockarApiCompleta([LEAD_COM_TELEFONE], []);
    render(<Leads />);
    await screen.findByText("Fulano");
    await userEvent.click(screen.getByLabelText(/selecionar lead 1/i));

    await userEvent.click(screen.getByRole("button", { name: /limpar sele/i }));

    expect(screen.queryByRole("button", { name: /enviar para os selecionados/i })).not.toBeInTheDocument();
  });

  it("o lote atualiza o status da linha, sem recarregar a lista", async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/vendedores")) return { ok: true, status: 200, json: async () => ({ itens: VENDEDORES }) };
      if (url.startsWith("/api/revisao")) return { ok: true, status: 200, json: async () => ({ itens: [] }) };
      if (url === "/api/lote/previa") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            selecionados: 1,
            no_lote: 1,
            acima_do_teto: 0,
            teto: 60,
            ids: [1],
            vao_sair: 1,
            pessoas: 1,
            repetidos: 0,
            bloqueados: 0,
            motivos: [],
            pausa_segundos: 12,
            janela: { aberta: true, inicio: "08:00", fim: "20:00" },
            conversa_wts_confere_no_envio: true,
          }),
        };
      }
      if (url === "/api/lote/enviar") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            resultados: [
              { lead_id: 1, situacao: "enviado", motivo: null, verificado: false, verificacao_detalhe: "QUEUED" },
            ],
            restantes: [],
            parado: null,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ itens: [LEAD_COM_TELEFONE] }) };
    });
    vi.stubGlobal("fetch", f);
    render(<Leads />);
    await screen.findByText("Fulano");

    await userEvent.click(screen.getByLabelText(/selecionar lead 1/i));
    await userEvent.click(screen.getByRole("button", { name: /enviar para os selecionados/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirmar envio/i }));

    await screen.findByText(/lote conclu[íi]do/i);
    expect(await within(screen.getByRole("table")).findByText("Enviado")).toBeInTheDocument();
    expect(f.mock.calls.filter((c) => String(c[0]).startsWith("/api/leads"))).toHaveLength(1);
  });
});

/**
 * A segunda metade da reclamacao do vendedor: "os meus so vieram leads que ja
 * comprou ou que ja estava em contato". A medicao confirmou: dos 40 leads mais
 * recentes com telefone, 30 ja tinham conversa no WTS nos ultimos 7 dias.
 *
 * A tela nao esconde esses leads por padrao. O estado e' um retrato com
 * validade curta, e esconder linha por causa de um retrato e' a forma mais
 * silenciosa de perder lead, que e' o pecado capital deste sistema. O que ela
 * faz e' MOSTRAR, contar quantos sao e deixar o filtro a um clique.
 */
function mockarComAtendimento(leads: unknown[], itens: unknown[]) {
  const f = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith("/api/vendedores")) return { ok: true, status: 200, json: async () => ({ itens: VENDEDORES }) };
    if (url.startsWith("/api/revisao")) return { ok: true, status: 200, json: async () => ({ itens: [] }) };
    if (url.startsWith("/api/conversas")) {
      return { ok: true, status: 200, json: async () => ({ itens, consultados: itens.length }) };
    }
    return { ok: true, status: 200, json: async () => ({ itens: leads }) };
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const EM_ATENDIMENTO = {
  lead_id: 1,
  estado: "em_atendimento",
  ultima_mensagem_em: "2026-09-14T13:00:00.000Z",
  conferido_em: "2026-09-14T15:00:00.000Z",
  detalhe: null,
};

describe("coluna de atendimento", () => {
  it("mostra na linha que o lead ja esta em atendimento", async () => {
    mockarComAtendimento([LEAD_COM_TELEFONE], [EM_ATENDIMENTO]);
    render(<Leads />);
    await screen.findByText("Fulano");

    expect(await within(screen.getByRole("table")).findByText(/em atendimento/i)).toBeInTheDocument();
  });

  it("pergunta pelos leads que estao na tela, nao pela base inteira", async () => {
    const f = mockarComAtendimento([LEAD_COM_TELEFONE], [EM_ATENDIMENTO]);
    render(<Leads />);
    await screen.findByText("Fulano");

    await waitFor(() => {
      const chamada = f.mock.calls.find((c) => String(c[0]).startsWith("/api/conversas"));
      expect(chamada).toBeDefined();
      const corpo = JSON.parse(String((chamada![1] as RequestInit).body)) as { leadIds: number[] };
      expect(corpo.leadIds).toEqual([1]);
    });
  });

  // A lista e' a fila de trabalho do vendedor. Uma falha na coluna de
  // atendimento, que e' informacao a mais, nao pode levar a fila embora.
  it("falha ao conferir atendimento nao derruba a lista", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.startsWith("/api/vendedores")) return { ok: true, status: 200, json: async () => ({ itens: VENDEDORES }) };
      if (url.startsWith("/api/revisao")) return { ok: true, status: 200, json: async () => ({ itens: [] }) };
      if (url.startsWith("/api/conversas")) throw new Error("rede caiu");
      return { ok: true, status: 200, json: async () => ({ itens: [LEAD_COM_TELEFONE] }) };
    });
    vi.stubGlobal("fetch", f);

    render(<Leads />);

    expect(await screen.findByText("Fulano")).toBeInTheDocument();
  });

  it("nao gasta chamada quando nao ha lead nenhum na lista", async () => {
    const f = mockarComAtendimento([], []);
    render(<Leads />);
    await screen.findByText(/nenhum lead/i);

    expect(f.mock.calls.filter((c) => String(c[0]).startsWith("/api/conversas"))).toHaveLength(0);
  });

  it("por padrao a lista mostra quem esta em atendimento, nao esconde", async () => {
    mockarComAtendimento([LEAD_COM_TELEFONE], [EM_ATENDIMENTO]);
    render(<Leads />);

    expect(await screen.findByText("Fulano")).toBeInTheDocument();
  });

  it("conta quantos ja estao em atendimento e oferece o filtro num clique", async () => {
    const f = mockarComAtendimento([LEAD_COM_TELEFONE], [EM_ATENDIMENTO]);
    render(<Leads />);
    await screen.findByText("Fulano");

    const atalho = await screen.findByRole("button", { name: /ainda sem conversa/i });
    f.mockClear();
    await userEvent.click(atalho);

    await waitFor(() => {
      expect(f).toHaveBeenCalledWith("/api/leads?atendimento=sem_conversa");
    });
  });

  // Mesmo motivo do filtro de portal e do de vendedor: filtrar em memoria
  // sobre os 50 mais recentes esconde o lead que nao couber nessa pagina.
  it("o filtro de atendimento vai para o servidor", async () => {
    const f = mockarComAtendimento([LEAD_COM_TELEFONE], []);
    render(<Leads />);
    await screen.findByText("Fulano");
    f.mockClear();

    await userEvent.selectOptions(screen.getByLabelText(/atendimento/i), "em_atendimento");

    await waitFor(() => {
      expect(f).toHaveBeenCalledWith("/api/leads?atendimento=em_atendimento");
    });
  });

  it("lead sem telefone nao promete conferencia que nao existe", async () => {
    const semTelefone = { id: 2, portal: "olx", nome: null, veiculo_texto: null, telefone_exibicao: null, status_ativacao: "pendente" };
    mockarComAtendimento([semTelefone], [
      { lead_id: 2, estado: "sem_telefone", ultima_mensagem_em: null, conferido_em: null, detalhe: null },
    ]);
    render(<Leads />);
    await screen.findByText(/sem telefone/i);

    expect(within(screen.getByRole("table")).queryByText(/em atendimento/i)).not.toBeInTheDocument();
  });
});

/**
 * O pedido do operador: o vendedor precisa saber quando aquele cliente
 * chegou. A coluna usa capturado_em (a data do e-mail), nunca created_at (a
 * data em que o sistema gravou a linha), ver api/_lib/processar.ts.
 */
describe("tela de leads: coluna de data", () => {
  it("a coluna Data fica logo depois de Portal", async () => {
    mockarApiDeLeads([LEAD_COM_TELEFONE], null);
    render(<Leads />);
    await screen.findByText("Fulano");

    const cabecalhos = within(screen.getByRole("table"))
      .getAllByRole("columnheader")
      .map((c) => c.textContent);
    expect(cabecalhos.indexOf("Data")).toBe(cabecalhos.indexOf("Portal") + 1);
  });

  // Ano fixo, bem no passado: independe de quando o teste roda, e o ano tem
  // que aparecer porque diverge do ano atual (ver dataAbsolutaLead).
  it("mostra a data absoluta, no fuso de Sao Paulo", async () => {
    mockarApiDeLeads([{ ...LEAD_COM_TELEFONE, capturado_em: "2020-05-04T12:00:00Z" }], null);
    render(<Leads />);
    await screen.findByText("Fulano");

    expect(within(screen.getByRole("table")).getByText("04/05/20")).toBeInTheDocument();
  });

  it("lead sem capturado_em nem created_at mostra o rotulo proprio, nao quebra a linha", async () => {
    mockarApiDeLeads([{ ...LEAD_COM_TELEFONE, capturado_em: null, created_at: null }], null);
    render(<Leads />);
    await screen.findByText("Fulano");

    expect(within(screen.getByRole("table")).getByText(/sem data/i)).toBeInTheDocument();
  });

  /**
   * O caso real do resgate da Lixeira: e-mail de ha' 90 dias, gravado no
   * banco agora mesmo (created_at de hoje). Se a coluna usasse created_at,
   * esse lead apareceria como "hoje", exatamente o problema que o
   * operador quer resolver. Ela tem que continuar dizendo que e' antigo.
   */
  it("usa capturado_em, nao created_at, quando os dois existem e divergem", async () => {
    const noventaDiasAtras = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const agoraIso = new Date().toISOString();
    mockarApiDeLeads(
      [{ ...LEAD_COM_TELEFONE, capturado_em: noventaDiasAtras, created_at: agoraIso }],
      null,
    );
    render(<Leads />);
    await screen.findByText("Fulano");

    const tabela = within(screen.getByRole("table"));
    expect(tabela.queryByText(/^hoje$/i)).not.toBeInTheDocument();
    expect(tabela.queryByText(/^ontem$/i)).not.toBeInTheDocument();
    expect(tabela.getByText(/há \d+ (dias|semanas|meses)/i)).toBeInTheDocument();
  });
});
