import { getSupabase } from "./supabase.js";

export interface Vendedor {
  id: number;
  nome: string;
  wts_user_id: string | null;
  ativo: boolean;
  ordem: number;
}

/**
 * As duas filas de trabalho, que são rodízios separados.
 *
 * Lead com telefone é trabalho de ligar; lead sem telefone (OLX e Mercado
 * Livre só mandam o botão) é trabalho de abrir o portal e buscar o contato
 * lá dentro. Misturar os dois num rodízio só desequilibra justamente a fila
 * que importa: quem recebesse dez leads sem telefone seguidos ficaria de
 * fora da fila de ligar sem nunca ter ligado para ninguém.
 */
export type Fila = "com_telefone" | "sem_telefone";

export function filaDoLead(telefoneE164: string | null): Fila {
  return telefoneE164 ? "com_telefone" : "sem_telefone";
}

export interface CargaVendedor {
  nome: string;
  ordem: number;
  carga: number;
}

/**
 * O critério do rodízio: o próximo lead vai para quem tem MENOS leads
 * naquela fila, e empate é desempatado pela ordem cadastrada.
 *
 * Por que contar em vez de guardar um contador rotativo: o contador teria
 * que morar em algum lugar, e nenhum lugar serve. Em memória ele não
 * sobrevive à function serverless (cada invocação pode ser uma instância
 * nova, e o cron roda sozinho). Em coluna no banco ele vira um segundo
 * estado que pode divergir do que aconteceu de verdade — basta um lead
 * apagado, um backfill ou um vendedor desativado e reativado para o contador
 * apontar para um lugar e a base para outro.
 *
 * Contar os leads é ler a própria verdade, e por isso se corrige sozinho:
 * a herança por telefone (que entrega leads fora do rodízio) desequilibra a
 * fila, e a contagem já devolve os próximos leads para quem ficou para trás.
 * Um contador rotativo não veria esse desequilíbrio.
 *
 * Empate pela ordem, e não aleatório, porque distribuição precisa ser
 * explicável para quem recebe: com a base zerada, o primeiro lead é sempre
 * do vendedor de ordem 1, e ninguém precisa acreditar em sorteio.
 */
export function escolherMenosCarregado(cargas: CargaVendedor[]): string | null {
  let escolhido: CargaVendedor | null = null;
  for (const candidato of cargas) {
    if (
      !escolhido ||
      candidato.carga < escolhido.carga ||
      (candidato.carga === escolhido.carga && candidato.ordem < escolhido.ordem)
    ) {
      escolhido = candidato;
    }
  }
  return escolhido?.nome ?? null;
}

/**
 * Lista os vendedores do cliente, em ordem de cadastro. `apenasAtivos` é o
 * que o rodízio usa; a lista completa serve para validar um filtro que cite
 * alguém que já saiu (os leads dele continuam existindo).
 */
export async function listarVendedores(
  clienteSlug: string,
  opcoes: { apenasAtivos: boolean },
): Promise<Vendedor[]> {
  const consulta = getSupabase()
    .from("portais_vendedores")
    .select("id,nome,wts_user_id,ativo,ordem")
    .eq("cliente_slug", clienteSlug);
  const filtrada = opcoes.apenasAtivos ? consulta.eq("ativo", true) : consulta;
  const { data, error } = await filtrada.order("ordem", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Vendedor[];
}

/**
 * De quem é este lead.
 *
 * Nunca lança: distribuição é conveniência, ingestão é a missão. Qualquer
 * falha aqui devolve null, o lead é gravado sem dono e o operador resolve na
 * tela. Um lead sem vendedor é um incômodo; um lead perdido porque a
 * distribuição estourou seria o oposto da promessa do sistema.
 */
export async function definirVendedor(a: {
  clienteSlug: string;
  telefoneE164: string | null;
  /** Só no reprocessamento do mesmo evento: preserva o dono já decidido. */
  eventoId?: number | null;
}): Promise<string | null> {
  try {
    return await resolver(a);
  } catch (e) {
    console.warn("distribuicao de vendedor falhou, lead fica sem dono", e);
    return null;
  }
}

async function resolver(a: {
  clienteSlug: string;
  telefoneE164: string | null;
  eventoId?: number | null;
}): Promise<string | null> {
  const sb = getSupabase();

  // Reprocessar o mesmo evento (parser melhorou, revisão corrigida) não pode
  // trocar o dono: o upsert de processar.ts reescreve a linha inteira, e sem
  // esta leitura o vendedor seria sorteado de novo a cada reprocessamento.
  if (a.eventoId) {
    const { data, error } = await sb
      .from("portais_leads")
      .select("vendedor")
      .eq("evento_id", a.eventoId)
      .limit(1);
    if (error) throw new Error(error.message);
    const atual = data?.[0]?.vendedor;
    if (typeof atual === "string" && atual.trim().length > 0) return atual;
  }

  const ativos = await listarVendedores(a.clienteSlug, { apenasAtivos: true });
  if (ativos.length === 0) return null;

  // Regra 1: o mesmo telefone sempre volta para o mesmo vendedor. O lead que
  // reaparece por outro portal dois meses depois cai com quem já falou com
  // ele — dois vendedores disputando a mesma pessoa é pior que distribuição
  // imperfeita.
  if (a.telefoneE164) {
    const { data, error } = await sb
      .from("portais_leads")
      .select("vendedor")
      .eq("cliente_slug", a.clienteSlug)
      .eq("telefone_e164", a.telefoneE164)
      .not("vendedor", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const dono = data?.[0]?.vendedor;
    // Dono que foi desativado saiu da operação: manter a herança entregaria
    // o lead a quem não vai atender ninguém. Aí a continuidade perde para o
    // atendimento, e o lead volta ao rodízio dos ativos.
    if (typeof dono === "string" && ativos.some((v) => v.nome === dono)) return dono;
  }

  // Regra 2: rodízio, um por fila.
  const fila = filaDoLead(a.telefoneE164);
  const cargas: CargaVendedor[] = [];
  for (const vendedor of ativos) {
    cargas.push({
      nome: vendedor.nome,
      ordem: vendedor.ordem,
      carga: await contarDaFila(sb, a.clienteSlug, vendedor.nome, fila),
    });
  }
  return escolherMenosCarregado(cargas);
}

/**
 * Quantos leads daquela fila já são do vendedor. `head: true` com
 * `count: "exact"` pede ao PostgREST só o número: nenhuma linha trafega, e
 * por isso a contagem não esbarra no corte silencioso de 1000 linhas nem
 * cresce de custo junto com a base.
 */
async function contarDaFila(
  sb: ReturnType<typeof getSupabase>,
  clienteSlug: string,
  nome: string,
  fila: Fila,
): Promise<number> {
  const consulta = sb
    .from("portais_leads")
    .select("id", { count: "exact", head: true })
    .eq("cliente_slug", clienteSlug)
    .eq("vendedor", nome);
  const filtrada =
    fila === "com_telefone"
      ? consulta.not("telefone_e164", "is", null)
      : consulta.is("telefone_e164", null);
  const { count, error } = await filtrada;
  if (error) throw new Error(error.message);
  return count ?? 0;
}
