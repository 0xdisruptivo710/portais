import { useEffect, useState } from "react";
import { buscarJson } from "../lib/api";
import { PORTAIS, rotuloPortal } from "../lib/portais";

interface NumeroPortal {
  portal: string;
  total: number;
  taxa_identificacao: number;
  revisao: number;
  tempo_mediano_primeiro_contato_min: number | null;
}

interface SerieDia {
  data: string;
  portal: string;
  total: number;
}

interface RespostaNumeros {
  dias: number;
  itens: NumeroPortal[];
  serie_diaria: SerieDia[];
}

const OPCOES_DIAS = [7, 30, 90];

/**
 * As três métricas da spec (seção Números do design): leads por portal por
 * dia, taxa de identificação automática e tempo até o primeiro contato.
 * A pergunta que a cliente paga para saber: qual portal vale o dinheiro.
 */
export default function Numeros() {
  const [dias, setDias] = useState(30);
  const [resposta, setResposta] = useState<RespostaNumeros | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    buscarJson<RespostaNumeros>(`/api/numeros?dias=${dias}`)
      .then((r) => {
        if (ativo) setResposta(r);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : "falha ao carregar os números");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [dias]);

  const diasComLead = [...new Set((resposta?.serie_diaria ?? []).map((s) => s.data))].sort();
  const totalPorDiaEPortal = new Map<string, number>();
  for (const s of resposta?.serie_diaria ?? []) totalPorDiaEPortal.set(`${s.data}|${s.portal}`, s.total);

  return (
    <section>
      <h1>Números</h1>
      <p>Quantos leads cada portal traz, quantos a equipe identifica sem revisão manual, e quanto tempo até o primeiro contato.</p>

      {erro && <p role="alert">Não foi possível carregar os números: {erro}</p>}
      {carregando && <p>Carregando números...</p>}

      {!carregando && resposta && (
        <>
          <table>
            <thead>
              <tr>
                <th>Portal</th>
                <th>Total de leads</th>
                <th>Identificação automática</th>
                <th>Em revisão</th>
                <th>Tempo até o 1º contato</th>
              </tr>
            </thead>
            <tbody>
              {resposta.itens.map((item) => (
                <tr key={item.portal}>
                  <td>{rotuloPortal(item.portal)}</td>
                  <td>{item.total}</td>
                  <td>{Math.round(item.taxa_identificacao * 100)}%</td>
                  <td>{item.revisao}</td>
                  <td>{formatarTempoContato(item.tempo_mediano_primeiro_contato_min)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Leads por dia</h2>
          <label>
            Janela
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              {OPCOES_DIAS.map((opcao) => (
                <option key={opcao} value={opcao}>
                  Últimos {opcao} dias
                </option>
              ))}
            </select>
          </label>

          {diasComLead.length === 0 && <p>Nenhum lead capturado nessa janela.</p>}

          {diasComLead.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Dia</th>
                  {PORTAIS.map((portal) => (
                    <th key={portal}>{rotuloPortal(portal)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diasComLead.map((dia) => (
                  <tr key={dia}>
                    <td>{dia}</td>
                    {PORTAIS.map((portal) => (
                      <td key={portal}>{totalPorDiaEPortal.get(`${dia}|${portal}`) ?? 0}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {!carregando && !erro && !resposta && <p>Sem leads registrados ainda.</p>}
    </section>
  );
}

function formatarTempoContato(minutos: number | null): string {
  if (minutos === null) return "sem contato ainda";
  if (minutos < 60) return `${minutos}min`;
  const horas = Math.floor(minutos / 60);
  const resto = Math.round(minutos % 60);
  return resto === 0 ? `${horas}h` : `${horas}h${resto}min`;
}
