import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  SearchX,
} from "lucide-react";
import BotaoEnviar from "../components/BotaoEnviar";
import { buscarJson } from "../lib/api";
import { PORTAIS, rotuloPortal, rotuloStatus, STATUS_ATIVACAO_OPCOES } from "../lib/portais";

interface LeadItem {
  id: number;
  portal: string;
  nome: string | null;
  veiculo_texto: string | null;
  telefone_e164?: string | null;
  telefone_exibicao: string | null;
  status_ativacao: string | null;
  capturado_em?: string | null;
  created_at?: string | null;
}

/**
 * O endpoint /api/leads já aceita `?portal=` nativamente: o filtro de portal
 * vai na query, não em memória (filtrar em memória sobre só os 50 mais
 * recentes escondia lead de um portal que não coubesse nessa primeira
 * página). Período e status ainda são filtrados aqui, sobre o que já veio —
 * o volume desta base ainda não justifica estender o contrato do endpoint
 * pra esses dois.
 *
 * Lista longa: densidade importa mais que respiro. A linha tem que entregar,
 * de relance, portal, nome, telefone, veículo e o estado do envio.
 */
export default function Leads() {
  const [itens, setItens] = useState<LeadItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [portalFiltro, setPortalFiltro] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [inicioFiltro, setInicioFiltro] = useState("");
  const [fimFiltro, setFimFiltro] = useState("");

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    const url = portalFiltro ? `/api/leads?portal=${portalFiltro}` : "/api/leads";
    buscarJson<{ itens: LeadItem[] }>(url)
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
  }, [portalFiltro]);

  const itensFiltrados = useMemo(() => {
    return itens.filter((item) => {
      if (statusFiltro && item.status_ativacao !== statusFiltro) return false;
      const dataItem = item.capturado_em ?? item.created_at ?? null;
      if (dataItem) {
        const dia = dataItem.slice(0, 10);
        if (inicioFiltro && dia < inicioFiltro) return false;
        if (fimFiltro && dia > fimFiltro) return false;
      }
      return true;
    });
  }, [itens, statusFiltro, inicioFiltro, fimFiltro]);

  const temFiltro = Boolean(portalFiltro || statusFiltro || inicioFiltro || fimFiltro);

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

  function limparFiltros() {
    setPortalFiltro("");
    setStatusFiltro("");
    setInicioFiltro("");
    setFimFiltro("");
  }

  const contagem = itensFiltrados.length === 1 ? "1 lead" : `${itensFiltrados.length} leads`;

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
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
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
      ) : itensFiltrados.length === 0 ? (
        <div className="estado-vazio">
          <SearchX aria-hidden="true" className="h-6 w-6 text-aios-texto-suave" />
          <p className="estado-vazio-titulo">Nenhum lead encontrado com esse filtro.</p>
          <p className="estado-vazio-texto">
            Amplie o período, escolha outro portal ou volte o status para Todos.
          </p>
        </div>
      ) : (
        <div className="tabela-rolagem tabela-rolagem-longa">
          <table className="tabela min-w-[860px]">
            <thead>
              <tr>
                <th scope="col">Portal</th>
                <th scope="col">Nome</th>
                <th scope="col">Telefone</th>
                <th scope="col">Veículo</th>
                <th scope="col">Status</th>
                <th scope="col">Envio</th>
              </tr>
            </thead>
            <tbody>
              {itensFiltrados.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="selo">{rotuloPortal(item.portal)}</span>
                  </td>
                  <td className="font-medium">{item.nome ?? <Ausente texto="sem nome" />}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    {item.telefone_exibicao ?? <Ausente texto="sem telefone" />}
                  </td>
                  {/* Linha de resumo do item, em violeta: é o detalhe que dá o
                      tom das listas do AIOS. */}
                  <td className="previa-linha min-w-[180px]">
                    {item.veiculo_texto ?? <Ausente texto="sem veículo" />}
                  </td>
                  <td>
                    <SeloStatus status={item.status_ativacao} />
                  </td>
                  {/* Sem telefone não existe para onde enviar (é o caso de OLX e
                      Mercado Livre, que não entregam o número no e-mail): a
                      célula fica vazia em vez de oferecer um botão que só
                      produziria erro. */}
                  <td>
                    {(item.telefone_e164 ?? item.telefone_exibicao) ? (
                      <BotaoEnviar
                        leadId={item.id}
                        aoEnviar={(statusAtivacao) => aplicarStatus(item.id, statusAtivacao)}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
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
    case "dry_run":
      return { classe: "", Icone: FlaskConical };
    default:
      return { classe: "selo-neutro", Icone: Clock };
  }
}
