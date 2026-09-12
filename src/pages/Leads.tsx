import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileQuestion,
  FlaskConical,
  Loader2,
  SearchX,
} from "lucide-react";
import BotaoEnviar from "../components/BotaoEnviar";
import EnvioEmLote from "../components/EnvioEmLote";
import PainelRevisao, { type EventoRevisao } from "../components/PainelRevisao";
import { buscarJson } from "../lib/api";
import {
  PORTAIS,
  rotuloPortal,
  rotuloStatus,
  STATUS_ATIVACAO_OPCOES,
  STATUS_REVISAO,
} from "../lib/portais";

interface LeadItem {
  id: number;
  portal: string;
  nome: string | null;
  veiculo_texto: string | null;
  telefone_e164?: string | null;
  telefone_exibicao: string | null;
  status_ativacao: string | null;
  vendedor?: string | null;
  capturado_em?: string | null;
  created_at?: string | null;
}

interface VendedorItem {
  id: number;
  nome: string;
  ordem: number;
}

/**
 * A linha da lista, venha ela de um lead ou de um evento que ainda espera
 * revisão. As duas coisas convivem na mesma tabela desde que a aba Revisão
 * saiu da navegação: o que o operador tem na frente é uma fila de trabalho,
 * e um item ilegível é trabalho tanto quanto um lead pronto.
 */
interface Linha {
  chave: string;
  tipo: "lead" | "revisao";
  id: number;
  portal: string;
  nome: string | null;
  telefoneE164: string | null;
  telefoneExibicao: string | null;
  /** Veículo, no lead; assunto do e-mail, no item de revisão. */
  resumo: string | null;
  vendedor: string | null;
  status: string;
  data: string | null;
  evento: EventoRevisao | null;
}

/**
 * O endpoint /api/leads aceita `?portal=` e `?vendedor=` nativamente: esses
 * dois filtros vão na query, não em memória (filtrar em memória sobre só os
 * 50 mais recentes escondia lead que não coubesse nessa primeira página, e no
 * caso do vendedor o buraco seria pior: o caso de uso é ele abrir o app e ver
 * só o que é dele). Período e status ainda são filtrados aqui, sobre o que já
 * veio — o volume desta base ainda não justifica estender o contrato do
 * endpoint pra esses dois.
 *
 * Lista longa: densidade importa mais que respiro. A linha tem que entregar,
 * de relance, portal, nome, telefone, veículo, dono e o estado do envio.
 */
export default function Leads() {
  const [itens, setItens] = useState<LeadItem[]>([]);
  const [revisao, setRevisao] = useState<EventoRevisao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<number | null>(null);

  const [portalFiltro, setPortalFiltro] = useState("");
  const [vendedorFiltro, setVendedorFiltro] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [inicioFiltro, setInicioFiltro] = useState("");
  const [fimFiltro, setFimFiltro] = useState("");
  const [vendedores, setVendedores] = useState<VendedorItem[]>([]);
  const [selecionados, setSelecionados] = useState<number[]>([]);
  // Trocar a geração refaz a busca dos leads. É o que traz para a lista o
  // lead que acabou de nascer de uma revisão completada.
  const [geracao, setGeracao] = useState(0);

  // A lista de vendedores é um detalhe do seletor, não a tela: se ela falhar,
  // o filtro fica só com "Todos" e os leads continuam aparecendo. Derrubar a
  // lista de leads por causa do seletor seria trocar o essencial pelo acessório.
  useEffect(() => {
    let ativo = true;
    buscarJson<{ itens: VendedorItem[] }>("/api/vendedores")
      .then((resposta) => {
        if (ativo && Array.isArray(resposta.itens)) setVendedores(resposta.itens);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  // Mesma disciplina para a fila de revisão: ela é uma segunda fonte na mesma
  // tela, e uma falha aqui não pode levar embora a lista de leads.
  useEffect(() => {
    let ativo = true;
    buscarJson<{ itens: EventoRevisao[] }>("/api/revisao")
      .then((resposta) => {
        if (ativo && Array.isArray(resposta.itens)) setRevisao(resposta.itens);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, [geracao]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    buscarJson<{ itens: LeadItem[] }>(urlDosLeads(portalFiltro, vendedorFiltro))
      .then((resposta) => {
        if (ativo) setItens(resposta.itens);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : "falha ao carregar os leads");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [portalFiltro, vendedorFiltro, geracao]);

  const linhas = useMemo(() => {
    const deLeads: Linha[] = itens.map((item) => ({
      chave: `lead-${item.id}`,
      tipo: "lead",
      id: item.id,
      portal: item.portal,
      nome: item.nome,
      telefoneE164: item.telefone_e164 ?? null,
      telefoneExibicao: item.telefone_exibicao,
      resumo: item.veiculo_texto,
      vendedor: item.vendedor ?? null,
      status: item.status_ativacao ?? "pendente",
      data: item.capturado_em ?? item.created_at ?? null,
      evento: null,
    }));

    // Item de revisão ainda não é lead: não tem telefone lido nem dono. Com
    // filtro de vendedor ligado ele some da tabela (não é de ninguém), e é
    // por isso que o aviso do topo conta a fila inteira, independente do
    // filtro: a fila de segurança nunca pode ficar invisível.
    const deRevisao: Linha[] = vendedorFiltro
      ? []
      : revisao.map((evento) => ({
          chave: `revisao-${evento.id}`,
          tipo: "revisao",
          id: evento.id,
          portal: evento.portal,
          nome: null,
          telefoneE164: null,
          telefoneExibicao: null,
          resumo: evento.assunto,
          vendedor: null,
          status: STATUS_REVISAO,
          data: evento.recebido_em,
          evento,
        }));

    // Ordem cronológica única para as duas fontes: o item de revisão é do dia
    // em que o e-mail chegou, e tirá-lo da linha do tempo esconderia que ele
    // está parado desde a semana passada.
    return [...deLeads, ...deRevisao].sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
  }, [itens, revisao, vendedorFiltro]);

  const linhasFiltradas = useMemo(() => {
    return linhas.filter((linha) => {
      if (statusFiltro && linha.status !== statusFiltro) return false;
      if (linha.data) {
        const dia = linha.data.slice(0, 10);
        if (inicioFiltro && dia < inicioFiltro) return false;
        if (fimFiltro && dia > fimFiltro) return false;
      }
      return true;
    });
  }, [linhas, statusFiltro, inicioFiltro, fimFiltro]);

  const temFiltro = Boolean(portalFiltro || vendedorFiltro || statusFiltro || inicioFiltro || fimFiltro);

  /**
   * Quem pode entrar num lote: lead de verdade e com telefone. Item de revisão
   * ainda não é lead, e lead sem telefone (OLX, Mercado Livre) não tem para
   * onde enviar — marcar qualquer um dos dois só produziria erro.
   */
  const selecionaveis = useMemo(
    () =>
      linhasFiltradas
        .filter((linha) => linha.tipo === "lead" && (linha.telefoneE164 ?? linha.telefoneExibicao))
        .map((linha) => linha.id),
    [linhasFiltradas],
  );

  /**
   * Trocar qualquer filtro limpa a seleção. O filtro é quem define o conjunto,
   * e uma seleção feita sobre outra lista, carregada para um filtro novo, é o
   * caminho mais curto para mandar mensagem para quem o operador não está
   * vendo na tela.
   */
  useEffect(() => {
    setSelecionados([]);
  }, [portalFiltro, vendedorFiltro, statusFiltro, inicioFiltro, fimFiltro]);

  const marcados = new Set(selecionados);
  const todosMarcados = selecionaveis.length > 0 && selecionaveis.every((id) => marcados.has(id));

  function alternar(id: number) {
    setSelecionados((atuais) =>
      atuais.includes(id) ? atuais.filter((outro) => outro !== id) : [...atuais, id],
    );
  }

  function alternarTodos() {
    setSelecionados(todosMarcados ? [] : selecionaveis);
  }

  /**
   * O resultado do lote, lead a lead, na linha correspondente. "bloqueado" é
   * o mesmo estado que o envio de um lead só grava quando uma guarda barra:
   * suprimido.
   */
  function aplicarResultadoDoLote(leadId: number, situacao: "enviado" | "bloqueado" | "falhou") {
    aplicarStatus(leadId, situacao === "enviado" ? "enviado" : situacao === "falhou" ? "falhou" : "suprimido");
  }

  /**
   * Depois do envio a linha passa a mostrar o estado real sem refazer a
   * busca: a resposta do /api/enviar já diz o que aconteceu com aquele lead,
   * e recarregar a lista inteira só devolveria o operador ao topo da página.
   */
  function aplicarStatus(id: number, statusAtivacao: string) {
    setItens((atuais) =>
      atuais.map((item) => (item.id === id ? { ...item, status_ativacao: statusAtivacao } : item)),
    );
  }

  /**
   * O evento sai da fila e a lista de leads é refeita: o lead que a pessoa
   * acabou de completar nasceu agora no banco e não estava na resposta
   * anterior. Aqui vale recarregar (ao contrário do envio, que só muda o
   * estado de uma linha que já está na tela).
   */
  function aoCompletarRevisao(eventoId: number) {
    setRevisao((atuais) => atuais.filter((evento) => evento.id !== eventoId));
    setExpandido(null);
    setGeracao((anterior) => anterior + 1);
  }

  function limparFiltros() {
    setPortalFiltro("");
    setVendedorFiltro("");
    setStatusFiltro("");
    setInicioFiltro("");
    setFimFiltro("");
  }

  function verRevisao() {
    setVendedorFiltro("");
    setStatusFiltro(STATUS_REVISAO);
  }

  const contagem = linhasFiltradas.length === 1 ? "1 lead" : `${linhasFiltradas.length} leads`;

  return (
    <section className="flex flex-col gap-4">
      {/* A plataforma já mostra onde o usuário está; repetir o nome da tela em
          um título grande empilharia dois cabeçalhos. O h1 segue no
          documento, para leitor de tela, sem ocupar espaço. */}
      <h1 className="sr-only">Leads</h1>

      <div className="cartao flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-aios-texto">
            {carregando ? "Carregando leads..." : contagem}
          </p>
          {temFiltro && (
            <button type="button" className="botao" onClick={limparFiltros}>
              Limpar filtros
            </button>
          )}
        </div>

        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
          role="group"
          aria-label="filtros de leads"
        >
          <div className="campo">
            <label className="rotulo" htmlFor="leads-portal">
              Portal
            </label>
            <select id="leads-portal" value={portalFiltro} onChange={(e) => setPortalFiltro(e.target.value)}>
              <option value="">Todos</option>
              {PORTAIS.map((portal) => (
                <option key={portal} value={portal}>
                  {rotuloPortal(portal)}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label className="rotulo" htmlFor="leads-vendedor">
              Vendedor
            </label>
            <select
              id="leads-vendedor"
              value={vendedorFiltro}
              onChange={(e) => setVendedorFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              {vendedores.map((vendedor) => (
                <option key={vendedor.id} value={vendedor.nome}>
                  {vendedor.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label className="rotulo" htmlFor="leads-status">
              Status
            </label>
            <select id="leads-status" value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
              <option value="">Todos</option>
              {STATUS_ATIVACAO_OPCOES.map((opcao) => (
                <option key={opcao.valor} value={opcao.valor}>
                  {opcao.rotulo}
                </option>
              ))}
            </select>
          </div>

          <div className="campo">
            <label className="rotulo" htmlFor="leads-inicio">
              Período, de
            </label>
            <input
              id="leads-inicio"
              type="date"
              value={inicioFiltro}
              onChange={(e) => setInicioFiltro(e.target.value)}
            />
          </div>

          <div className="campo">
            <label className="rotulo" htmlFor="leads-fim">
              até
            </label>
            <input
              id="leads-fim"
              type="date"
              value={fimFiltro}
              onChange={(e) => setFimFiltro(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* A aba Revisão tinha um selo numérico vermelho, e era ele que dizia se
          alguém precisava abrir aquela tela hoje. A aba saiu; o número não
          podia sair junto, senão a fila de segurança ficaria invisível até
          alguém pensar em procurar por ela. */}
      {revisao.length > 0 && statusFiltro !== STATUS_REVISAO && (
        <div className="faixa-atencao items-center justify-between gap-3">
          <span className="flex items-start gap-2">
            <FileQuestion aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            {revisao.length === 1
              ? "1 lead precisa de revisão: o e-mail chegou, mas o sistema não conseguiu ler os dados."
              : `${revisao.length} leads precisam de revisão: o e-mail chegou, mas o sistema não conseguiu ler os dados.`}
          </span>
          <button type="button" className="botao shrink-0" onClick={verRevisao}>
            Ver os que precisam de revisão
          </button>
        </div>
      )}

      {/* A barra do lote só existe quando há seleção: ela é a antessala do
          caminho mais perigoso do painel, e não tem por que ficar de pé
          enquanto o operador só está lendo a lista. */}
      {selecionados.length > 0 && (
        <EnvioEmLote
          ids={selecionados}
          descricaoFiltro={descreverFiltro({
            portal: portalFiltro,
            vendedor: vendedorFiltro,
            status: statusFiltro,
            inicio: inicioFiltro,
            fim: fimFiltro,
          })}
          aoResultado={aplicarResultadoDoLote}
          aoLimparSelecao={() => setSelecionados([])}
        />
      )}

      {erro && (
        <p role="alert" className="faixa-erro">
          <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
          Não foi possível carregar os leads agora: {erro}
        </p>
      )}

      {carregando ? (
        <p className="carregando">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando leads...
        </p>
      ) : linhasFiltradas.length === 0 ? (
        <div className="estado-vazio">
          <SearchX aria-hidden="true" className="h-6 w-6 text-aios-texto-suave" />
          <p className="estado-vazio-titulo">Nenhum lead encontrado com esse filtro.</p>
          <p className="estado-vazio-texto">
            Amplie o período, escolha outro portal ou volte o status para Todos.
          </p>
        </div>
      ) : (
        <div className="tabela-rolagem tabela-rolagem-longa">
          <table className="tabela min-w-[960px]">
            <thead>
              <tr>
                <th scope="col" className="w-9">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos os visíveis"
                    checked={todosMarcados}
                    onChange={alternarTodos}
                    disabled={selecionaveis.length === 0}
                  />
                </th>
                <th scope="col">Portal</th>
                <th scope="col">Nome</th>
                <th scope="col">Telefone</th>
                <th scope="col">Veículo</th>
                <th scope="col">Vendedor</th>
                <th scope="col">Status</th>
                <th scope="col">Envio</th>
              </tr>
            </thead>
            <tbody>
              {linhasFiltradas.map((linha) => (
                <Fragment key={linha.chave}>
                  <tr>
                    <td>
                      {linha.tipo === "lead" && (linha.telefoneE164 ?? linha.telefoneExibicao) ? (
                        <input
                          type="checkbox"
                          aria-label={`Selecionar lead ${linha.id}`}
                          checked={marcados.has(linha.id)}
                          onChange={() => alternar(linha.id)}
                        />
                      ) : null}
                    </td>
                    <td>
                      <span className="selo">{rotuloPortal(linha.portal)}</span>
                    </td>
                    <td className="font-medium">{linha.nome ?? <Ausente texto="sem nome" />}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {linha.telefoneExibicao ?? <Ausente texto="sem telefone" />}
                    </td>
                    {/* Linha de resumo do item, em violeta: é o detalhe que dá o
                        tom das listas do AIOS. No item de revisão, o resumo
                        possível é o assunto do e-mail. */}
                    <td className="previa-linha min-w-[180px]">
                      {linha.resumo ?? <Ausente texto={linha.tipo === "revisao" ? "sem assunto" : "sem veículo"} />}
                    </td>
                    {/* Sem esta coluna, a divisão do trabalho só existiria
                        dentro do filtro: a lista com "Todos" não diria de quem
                        é cada lead. */}
                    <td className="whitespace-nowrap">
                      {linha.vendedor ?? <Ausente texto="sem vendedor" />}
                    </td>
                    <td>
                      <SeloStatus status={linha.status} />
                    </td>
                    <td>
                      {linha.tipo === "revisao" ? (
                        <button
                          type="button"
                          className="botao botao-acao"
                          aria-expanded={expandido === linha.id}
                          onClick={() => setExpandido(expandido === linha.id ? null : linha.id)}
                        >
                          {expandido === linha.id ? (
                            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                          )}
                          Revisar
                        </button>
                      ) : /* Sem telefone não existe para onde enviar (é o caso de
                            OLX e Mercado Livre, que não entregam o número no
                            e-mail): a célula fica vazia em vez de oferecer um
                            botão que só produziria erro. */
                      linha.telefoneE164 ?? linha.telefoneExibicao ? (
                        <BotaoEnviar
                          leadId={linha.id}
                          aoEnviar={(statusAtivacao) => aplicarStatus(linha.id, statusAtivacao)}
                        />
                      ) : null}
                    </td>
                  </tr>
                  {/* Linha expansível, e não janela sobreposta: o operador está
                      lendo uma fila, e o item precisa continuar no lugar dele
                      enquanto o e-mail é lido. Uma janela esconderia a lista,
                      exigiria foco próprio e devolveria o operador ao topo. */}
                  {linha.tipo === "revisao" && expandido === linha.id && linha.evento && (
                    <tr>
                      <td colSpan={8} className="bg-aios-fundo/60 p-3">
                        <PainelRevisao
                          evento={linha.evento}
                          aoCompletar={() => aoCompletarRevisao(linha.id)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Monta a query do endpoint. URLSearchParams e não concatenação: nome de
 * vendedor tem acento e espaço, e "Ana Paula" precisa chegar codificado. Sem
 * filtro nenhum a URL fica sem "?", que é o mesmo endereço de antes.
 */
function urlDosLeads(portal: string, vendedor: string): string {
  const parametros = new URLSearchParams();
  if (portal) parametros.set("portal", portal);
  if (vendedor) parametros.set("vendedor", vendedor);
  const query = parametros.toString();
  return query ? `/api/leads?${query}` : "/api/leads";
}

/**
 * O filtro em palavras, para a confirmação do lote citar. "Todos" nunca pode
 * querer dizer a base inteira: quer dizer o que a tela está mostrando, e o
 * operador precisa ler isso escrito antes de liberar dezenas de mensagens.
 */
function descreverFiltro(f: {
  portal: string;
  vendedor: string;
  status: string;
  inicio: string;
  fim: string;
}): string {
  const partes: string[] = [];
  if (f.portal) partes.push(`Portal ${rotuloPortal(f.portal)}`);
  if (f.vendedor) partes.push(`Vendedor ${f.vendedor}`);
  if (f.status) partes.push(`Status ${rotuloStatus(f.status)}`);
  if (f.inicio || f.fim) partes.push(`Período de ${f.inicio || "sempre"} até ${f.fim || "hoje"}`);
  return partes.length > 0 ? partes.join(", ") : "todos os leads da lista";
}

function Ausente({ texto }: { texto: string }) {
  return <span className="text-aios-texto-suave">{texto}</span>;
}

/**
 * Estado do envio daquele lead. Cada estado tem ícone próprio além da cor:
 * quem não distingue verde de vermelho continua lendo a lista pela forma.
 */
function SeloStatus({ status }: { status: string | null }) {
  const { classe, Icone } = aparenciaDoStatus(status);
  return (
    <span className={`selo ${classe}`}>
      <Icone aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {rotuloStatus(status)}
    </span>
  );
}

function aparenciaDoStatus(status: string | null) {
  switch (status) {
    case "enviado":
      return { classe: "selo-ok", Icone: CheckCircle2 };
    case "suprimido":
      return { classe: "selo-atencao", Icone: Ban };
    case "falhou":
      return { classe: "selo-erro", Icone: AlertTriangle };
    case STATUS_REVISAO:
      return { classe: "selo-atencao", Icone: FileQuestion };
    case "dry_run":
      return { classe: "", Icone: FlaskConical };
    default:
      return { classe: "selo-neutro", Icone: Clock };
  }
}
