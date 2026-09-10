import { useEffect, useState } from "react";
import { buscarJson } from "../lib/api";
import { rotuloPortal } from "../lib/portais";

interface NumeroPortal {
  portal: string;
  total: number;
  taxa_identificacao: number;
  revisao: number;
}

/**
 * A pergunta que a cliente paga para saber: qual portal vale o dinheiro.
 * Consome exatamente o que /api/numeros devolve hoje (total por portal, taxa
 * de identificação automática e quantos foram para revisão). "Tempo até o
 * primeiro contato", citado no brief, não está no payload deste endpoint
 * ainda (precisaria olhar enviado_em - capturado_em em portais_leads); não
 * inventamos essa coluna aqui.
 */
export default function Numeros() {
  const [itens, setItens] = useState<NumeroPortal[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    buscarJson<{ itens: NumeroPortal[] }>("/api/numeros")
      .then((resposta) => {
        if (ativo) setItens(resposta.itens);
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
  }, []);

  return (
    <section>
      <h1>Números</h1>
      <p>Quantos leads cada portal traz, e quantos a equipe consegue identificar sem revisão manual.</p>

      {erro && <p role="alert">Não foi possível carregar os números: {erro}</p>}
      {carregando && <p>Carregando números...</p>}

      {!carregando && itens.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Portal</th>
              <th>Total de leads</th>
              <th>Identificação automática</th>
              <th>Em revisão</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.portal}>
                <td>{rotuloPortal(item.portal)}</td>
                <td>{item.total}</td>
                <td>{Math.round(item.taxa_identificacao * 100)}%</td>
                <td>{item.revisao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!carregando && !erro && itens.length === 0 && <p>Sem leads registrados ainda.</p>}
    </section>
  );
}
