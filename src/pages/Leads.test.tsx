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
