import { render, screen, within } from "@testing-library/react";
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ itens: [{ id: 1, portal: "webmotors", nome: "Fulano", veiculo_texto: "Civic 2020", telefone_exibicao: "+55 (15) 99128-0217", status_ativacao: "dry_run" }] }),
    }));
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
