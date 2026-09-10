import { useEffect, useMemo, useState } from "react";
import { buscarJson } from "../lib/api";
import { PORTAIS, rotuloPortal, STATUS_ATIVACAO_OPCOES } from "../lib/portais";

interface LeadItem {
  id: number;
  portal: string;
  nome: string | null;
  veiculo_texto: string | null;
  telefone_exibicao: string | null;
  status_ativacao: string | null;
  capturado_em?: string | null;
  created_at?: string | null;
}

/**
 * O endpoint /api/leads só filtra por portal (e paginação) hoje. Período e
 * status são filtrados aqui, em memória, sobre o que já veio: o volume desta
 * base ainda não justifica mexer no contrato do endpoint por isso.
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
    buscarJson<{ itens: LeadItem[] }>("/api/leads")
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
  }, []);

  const itensFiltrados = useMemo(() => {
    return itens.filter((item) => {
      if (portalFiltro && item.portal !== portalFiltro) return false;
      if (statusFiltro && item.status_ativacao !== statusFiltro) return false;
      const dataItem = item.capturado_em ?? item.created_at ?? null;
      if (dataItem) {
        const dia = dataItem.slice(0, 10);
        if (inicioFiltro && dia < inicioFiltro) return false;
        if (fimFiltro && dia > fimFiltro) return false;
      }
      return true;
    });
  }, [itens, portalFiltro, statusFiltro, inicioFiltro, fimFiltro]);

  return (
    <section>
      <h1>Leads</h1>

      <div className="filtros" role="group" aria-label="filtros de leads">
        <label>
          Portal
          <select value={portalFiltro} onChange={(e) => setPortalFiltro(e.target.value)}>
            <option value="">Todos</option>
            {PORTAIS.map((portal) => (
              <option key={portal} value={portal}>
                {rotuloPortal(portal)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Status
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
            <option value="">Todos</option>
            {STATUS_ATIVACAO_OPCOES.map((opcao) => (
              <option key={opcao.valor} value={opcao.valor}>
                {opcao.rotulo}
              </option>
            ))}
          </select>
        </label>

        <label>
          Período, de
          <input type="date" value={inicioFiltro} onChange={(e) => setInicioFiltro(e.target.value)} />
        </label>

        <label>
          até
          <input type="date" value={fimFiltro} onChange={(e) => setFimFiltro(e.target.value)} />
        </label>
      </div>

      {erro && <p role="alert">Não foi possível carregar os leads agora: {erro}</p>}

      {carregando ? (
        <p>Carregando leads...</p>
      ) : itensFiltrados.length === 0 ? (
        <p>Nenhum lead encontrado com esse filtro.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Portal</th>
              <th>Nome</th>
              <th>Veículo</th>
              <th>Telefone</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {itensFiltrados.map((item) => (
              <tr key={item.id}>
                <td>{rotuloPortal(item.portal)}</td>
                <td>{item.nome ?? "sem nome"}</td>
                <td>{item.veiculo_texto ?? "sem veículo"}</td>
                <td>{item.telefone_exibicao ?? "sem telefone"}</td>
                <td>{item.status_ativacao ?? "pendente"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
