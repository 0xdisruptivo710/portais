import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ getSupabase: vi.fn() }));

import { getSupabase } from "./supabase";
import { definirVendedor, escolherMenosCarregado, filaDoLead, listarVendedores } from "./vendedores";

interface LinhaLead {
  id: number;
  evento_id: number;
  cliente_slug: string;
  telefone_e164: string | null;
  vendedor: string | null;
  created_at: string;
}

interface LinhaVendedor {
  id: number;
  cliente_slug: string;
  nome: string;
  wts_user_id: string | null;
  ativo: boolean;
  ordem: number;
}

interface Filtro {
  tipo: "eq" | "is" | "not_is";
  coluna: string;
  valor?: unknown;
}

/**
 * PostgREST de mentira, em memória, com só os filtros que este módulo usa.
 *
 * É mais que um dublê de retorno fixo de propósito: a regra de herança e a
 * de rodízio por fila só valem alguma coisa se o que foi GRAVADO influenciar
 * a próxima decisão. Com retorno fixo, o teste de "a distribuição continua
 * equilibrada ao longo de uma sequência" não testaria nada. Método que o
 * código chame e não exista aqui estoura, que é o comportamento desejado:
 * encadeamento errado quebra o teste em vez de passar calado.
 */
function criarBanco(estado: { leads: LinhaLead[]; vendedores: LinhaVendedor[]; falhar?: boolean }) {
  const chamadas = { contagens: 0 };

  function consultar(tabela: string, opcoes: { head?: boolean; count?: string } = {}) {
    const filtros: Filtro[] = [];
    let limite: number | null = null;
    let ordenarPor: { coluna: string; crescente: boolean } | null = null;

    function aplicar(): (LinhaLead | LinhaVendedor)[] {
      const base: (LinhaLead | LinhaVendedor)[] =
        tabela === "portais_leads" ? [...estado.leads] : [...estado.vendedores];
      let linhas = base.filter((linha) => {
        const registro = linha as unknown as Record<string, unknown>;
        return filtros.every((f) => {
          if (f.tipo === "eq") return registro[f.coluna] === f.valor;
          if (f.tipo === "is") return registro[f.coluna] === null;
          return registro[f.coluna] !== null;
        });
      });
      if (ordenarPor) {
        const { coluna, crescente } = ordenarPor;
        linhas = [...linhas].sort((a, b) => {
          const va = String((a as unknown as Record<string, unknown>)[coluna] ?? "");
          const vb = String((b as unknown as Record<string, unknown>)[coluna] ?? "");
          return crescente ? va.localeCompare(vb) : vb.localeCompare(va);
        });
      }
      if (limite !== null) linhas = linhas.slice(0, limite);
      return linhas;
    }

    const construtor = {
      eq(coluna: string, valor: unknown) {
        filtros.push({ tipo: "eq", coluna, valor });
        return construtor;
      },
      is(coluna: string, valor: unknown) {
        if (valor !== null) throw new Error("o mock só conhece .is(coluna, null)");
        filtros.push({ tipo: "is", coluna });
        return construtor;
      },
      not(coluna: string, operador: string, valor: unknown) {
        if (operador !== "is" || valor !== null) throw new Error("o mock só conhece .not(coluna, 'is', null)");
        filtros.push({ tipo: "not_is", coluna });
        return construtor;
      },
      order(coluna: string, opcoesOrdem: { ascending: boolean }) {
        ordenarPor = { coluna, crescente: opcoesOrdem.ascending };
        return construtor;
      },
      limit(n: number) {
        limite = n;
        return construtor;
      },
      // O construtor do supabase-js é "thenable": o await dispara a consulta.
      then(resolver: (r: unknown) => unknown) {
        if (estado.falhar) return resolver({ data: null, count: null, error: { message: "banco fora do ar" } });
        const linhas = aplicar();
        if (opcoes.count === "exact") chamadas.contagens++;
        return resolver({
          data: opcoes.head ? null : linhas,
          count: opcoes.count === "exact" ? linhas.length : null,
          error: null,
        });
      },
    };
    return construtor;
  }

  const from = vi.fn((tabela: string) => ({
    select: (_colunas: string, opcoes?: { head?: boolean; count?: string }) => consultar(tabela, opcoes ?? {}),
  }));

  vi.mocked(getSupabase).mockReturnValue({ from } as never);
  return { from, chamadas };
}

const VENDEDORES: LinhaVendedor[] = [
  { id: 1, cliente_slug: "malentachi", nome: "Murilo", wts_user_id: "a", ativo: true, ordem: 1 },
  { id: 2, cliente_slug: "malentachi", nome: "Beatryz", wts_user_id: "b", ativo: true, ordem: 2 },
  { id: 3, cliente_slug: "malentachi", nome: "Vinicius", wts_user_id: "c", ativo: true, ordem: 3 },
];

let proximoId = 1;

function gravar(estado: { leads: LinhaLead[] }, telefone: string | null, vendedor: string | null): LinhaLead {
  const linha: LinhaLead = {
    id: proximoId,
    evento_id: proximoId,
    cliente_slug: "malentachi",
    telefone_e164: telefone,
    vendedor,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, proximoId)).toISOString(),
  };
  proximoId++;
  estado.leads.push(linha);
  return linha;
}

beforeEach(() => {
  vi.mocked(getSupabase).mockReset();
  proximoId = 1;
});

describe("escolherMenosCarregado", () => {
  it("dá o lead a quem tem menos, não ao próximo da ordem", () => {
    const escolhido = escolherMenosCarregado([
      { nome: "Murilo", ordem: 1, carga: 10 },
      { nome: "Beatryz", ordem: 2, carga: 3 },
      { nome: "Vinicius", ordem: 3, carga: 7 },
    ]);
    expect(escolhido).toBe("Beatryz");
  });

  it("empate é resolvido pela ordem cadastrada, nunca pelo acaso", () => {
    const escolhido = escolherMenosCarregado([
      { nome: "Vinicius", ordem: 3, carga: 4 },
      { nome: "Beatryz", ordem: 2, carga: 4 },
      { nome: "Murilo", ordem: 1, carga: 4 },
    ]);
    expect(escolhido).toBe("Murilo");
  });

  it("sem ninguém na lista devolve null, nunca um nome inventado", () => {
    expect(escolherMenosCarregado([])).toBeNull();
  });
});

describe("filaDoLead", () => {
  it("separa quem tem telefone de quem não tem", () => {
    expect(filaDoLead("5515991280217")).toBe("com_telefone");
    expect(filaDoLead(null)).toBe("sem_telefone");
  });
});

describe("definirVendedor: herança por telefone", () => {
  it("telefone que já tem dono volta para o mesmo dono, mesmo sendo o mais carregado", async () => {
    const estado = { leads: [] as LinhaLead[], vendedores: VENDEDORES };
    criarBanco(estado);

    // Murilo já carrega a fila inteira: o rodízio sozinho mandaria para outro.
    for (let i = 0; i < 8; i++) gravar(estado, `55159912802${10 + i}`, "Murilo");
    const doDono = gravar(estado, "5515999999999", "Murilo");

    const escolhido = await definirVendedor({
      clienteSlug: "malentachi",
      telefoneE164: doDono.telefone_e164,
    });

    expect(escolhido).toBe("Murilo");
  });

  it("herda do contato mais recente quando o telefone passou por mais de um dono", async () => {
    const estado = { leads: [] as LinhaLead[], vendedores: VENDEDORES };
    criarBanco(estado);
    gravar(estado, "5515999999999", "Beatryz");
    gravar(estado, "5515999999999", "Vinicius");

    const escolhido = await definirVendedor({
      clienteSlug: "malentachi",
      telefoneE164: "5515999999999",
    });

    expect(escolhido).toBe("Vinicius");
  });

  it("dono desativado devolve o lead ao rodízio em vez de entregar a quem saiu", async () => {
    const estado = {
      leads: [] as LinhaLead[],
      vendedores: [...VENDEDORES, { id: 4, cliente_slug: "malentachi", nome: "Saiu", wts_user_id: null, ativo: false, ordem: 4 }],
    };
    criarBanco(estado);
    gravar(estado, "5515999999999", "Saiu");

    const escolhido = await definirVendedor({
      clienteSlug: "malentachi",
      telefoneE164: "5515999999999",
    });

    expect(escolhido).not.toBe("Saiu");
    expect(["Murilo", "Beatryz", "Vinicius"]).toContain(escolhido);
  });

  it("reprocessar o mesmo evento não troca o dono do lead", async () => {
    const estado = { leads: [] as LinhaLead[], vendedores: VENDEDORES };
    criarBanco(estado);
    const lead = gravar(estado, null, "Vinicius");

    const escolhido = await definirVendedor({
      clienteSlug: "malentachi",
      telefoneE164: null,
      eventoId: lead.evento_id,
    });

    expect(escolhido).toBe("Vinicius");
  });
});

describe("definirVendedor: rodízios separados por fila", () => {
  it("uma enxurrada de leads sem telefone não desequilibra a fila de quem tem telefone", async () => {
    const estado = { leads: [] as LinhaLead[], vendedores: VENDEDORES };
    criarBanco(estado);

    // 9 leads sem telefone, todos do Murilo: é a fila de abrir portal, e ela
    // não pode empurrar a fila de ligar para os outros dois.
    for (let i = 0; i < 9; i++) gravar(estado, null, "Murilo");

    const escolhido = await definirVendedor({
      clienteSlug: "malentachi",
      telefoneE164: "5515991280217",
    });

    // Fila de quem tem telefone está zerada para os três: vale a ordem.
    expect(escolhido).toBe("Murilo");
  });

  it("distribuição continua equilibrada ao longo de uma sequência de leads novos", async () => {
    const estado = { leads: [] as LinhaLead[], vendedores: VENDEDORES };
    criarBanco(estado);

    for (let i = 0; i < 30; i++) {
      const telefone = i % 2 === 0 ? `5515991${String(280000 + i).padStart(6, "0")}` : null;
      const escolhido = await definirVendedor({ clienteSlug: "malentachi", telefoneE164: telefone });
      gravar(estado, telefone, escolhido);
    }

    for (const comTelefone of [true, false]) {
      const contagem = VENDEDORES.map(
        (v) =>
          estado.leads.filter(
            (l) => l.vendedor === v.nome && (l.telefone_e164 !== null) === comTelefone,
          ).length,
      );
      expect(Math.max(...contagem) - Math.min(...contagem)).toBeLessThanOrEqual(1);
      expect(contagem.reduce((s, n) => s + n, 0)).toBe(15);
    }
  });

  it("lead que volta por outro portal não conta duas vezes no equilíbrio da fila", async () => {
    const estado = { leads: [] as LinhaLead[], vendedores: VENDEDORES };
    criarBanco(estado);

    // O mesmo telefone entra cinco vezes: sempre o mesmo dono, e a fila dos
    // outros dois continua sendo alimentada pelos telefones novos.
    for (let i = 0; i < 5; i++) {
      const escolhido = await definirVendedor({ clienteSlug: "malentachi", telefoneE164: "5515999999999" });
      gravar(estado, "5515999999999", escolhido);
    }
    const donos = new Set(estado.leads.map((l) => l.vendedor));
    expect(donos.size).toBe(1);

    const novo = await definirVendedor({ clienteSlug: "malentachi", telefoneE164: "5515988888888" });
    expect(novo).not.toBe([...donos][0]);
  });
});

describe("definirVendedor: nunca quebra a ingestão", () => {
  it("sem vendedor ativo nenhum, o lead fica sem dono em vez de receber um nome inventado", async () => {
    criarBanco({ leads: [], vendedores: VENDEDORES.map((v) => ({ ...v, ativo: false })) });

    const escolhido = await definirVendedor({ clienteSlug: "malentachi", telefoneE164: "5515991280217" });

    expect(escolhido).toBeNull();
  });

  it("banco fora do ar devolve null, sem derrubar quem está gravando o lead", async () => {
    criarBanco({ leads: [], vendedores: VENDEDORES, falhar: true });

    const escolhido = await definirVendedor({ clienteSlug: "malentachi", telefoneE164: "5515991280217" });

    expect(escolhido).toBeNull();
  });

  it("cliente sem linha em portais_vendedores fica sem dono", async () => {
    criarBanco({ leads: [], vendedores: [] });

    const escolhido = await definirVendedor({ clienteSlug: "outro", telefoneE164: "5515991280217" });

    expect(escolhido).toBeNull();
  });
});

describe("listarVendedores", () => {
  it("apenasAtivos deixa de fora quem foi desativado", async () => {
    criarBanco({
      leads: [],
      vendedores: [...VENDEDORES, { id: 4, cliente_slug: "malentachi", nome: "Saiu", wts_user_id: null, ativo: false, ordem: 4 }],
    });

    const ativos = await listarVendedores("malentachi", { apenasAtivos: true });
    const todos = await listarVendedores("malentachi", { apenasAtivos: false });

    expect(ativos.map((v) => v.nome)).toEqual(["Murilo", "Beatryz", "Vinicius"]);
    expect(todos.map((v) => v.nome)).toContain("Saiu");
  });

  it("não mistura vendedor de outro cliente", async () => {
    criarBanco({
      leads: [],
      vendedores: [...VENDEDORES, { id: 9, cliente_slug: "outro", nome: "De Fora", wts_user_id: null, ativo: true, ordem: 1 }],
    });

    const ativos = await listarVendedores("malentachi", { apenasAtivos: true });

    expect(ativos.map((v) => v.nome)).not.toContain("De Fora");
  });
});
