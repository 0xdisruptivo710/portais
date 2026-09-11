import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
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

/* Geometria das séries diárias, em unidades do viewBox. Marca fina, barra
 * com topo arredondado e base reta, 2px de respiro entre barras vizinhas. */
const LARGURA_SERIE = 320;
const ALTURA_SERIE = 56;
const RAIO_TOPO = 4;

/**
 * As três métricas da spec (seção Números do design): leads por portal por
 * dia, taxa de identificação automática e tempo até o primeiro contato.
 * A pergunta que a cliente paga para saber: qual portal vale o dinheiro.
 *
 * Um detalhe do contrato do /api/numeros que a tela precisa deixar claro:
 * total, taxa, revisão e tempo de contato são vitalícios; só a série diária
 * respeita a janela escolhida. Por isso o seletor de dias mora junto da
 * série, e não no topo da tela, onde pareceria filtrar tudo.
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

  const serie = useMemo(() => montarSerie(resposta?.serie_diaria ?? []), [resposta]);
  const totais = useMemo(() => somarTotais(resposta?.itens ?? []), [resposta]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="sr-only">Números</h1>

      <p className="tela-descricao">
        Quantos leads cada portal traz, quantos a equipe identifica sem revisão manual, e quanto tempo
        até o primeiro contato.
      </p>

      {erro && (
        <p role="alert" className="faixa-erro">
          <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
          Não foi possível carregar os números: {erro}
        </p>
      )}

      {carregando && (
        <p className="carregando">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando números...
        </p>
      )}

      {!carregando && resposta && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Indicador rotulo="Leads capturados" valor={formatarInteiro(totais.total)} />
            <Indicador
              rotulo="Identificação automática"
              valor={`${Math.round(totais.taxa * 100)}%`}
              apoio="sem passar pela revisão"
            />
            <Indicador rotulo="Em revisão" valor={formatarInteiro(totais.revisao)} apoio="aguardando alguém" />
          </div>

          <div className="tabela-rolagem">
            <table className="tabela min-w-[680px]">
              <caption className="px-3 py-2 text-left text-[13px] font-semibold text-aios-texto">
                Placar de cada portal
                <span className="block font-normal text-aios-texto-suave">
                  Números de toda a operação, do primeiro lead capturado até hoje.
                </span>
              </caption>
              <thead>
                <tr>
                  <th scope="col">Portal</th>
                  <th scope="col" className="numero-coluna">
                    Total de leads
                  </th>
                  <th scope="col" className="numero-coluna">
                    Identificação automática
                  </th>
                  <th scope="col" className="numero-coluna">
                    Em revisão
                  </th>
                  <th scope="col" className="numero-coluna">
                    Tempo até o 1º contato
                  </th>
                </tr>
              </thead>
              <tbody>
                {resposta.itens.map((item) => (
                  <tr key={item.portal}>
                    <td>
                      <span className="selo">{rotuloPortal(item.portal)}</span>
                    </td>
                    <td className="numero-coluna font-medium">{item.total}</td>
                    <td className="numero-coluna">{Math.round(item.taxa_identificacao * 100)}%</td>
                    <td className="numero-coluna">{item.revisao}</td>
                    <td className="numero-coluna whitespace-nowrap">
                      {formatarTempoContato(item.tempo_mediano_primeiro_contato_min)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cartao flex flex-col gap-4 p-3 sm:p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="tela-topo">
                <h2 className="text-[14px]">Leads por dia</h2>
                <p className="tela-descricao">
                  A única parte da tela que muda com o período escolhido ao lado.
                </p>
              </div>

              <div className="campo w-full sm:w-auto">
                <label className="rotulo" htmlFor="numeros-dias">
                  Janela
                </label>
                <select
                  id="numeros-dias"
                  value={dias}
                  onChange={(e) => setDias(Number(e.target.value))}
                  className="sm:w-[180px]"
                >
                  {OPCOES_DIAS.map((opcao) => (
                    <option key={opcao} value={opcao}>
                      Últimos {opcao} dias
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {serie.dias.length === 0 ? (
              <div className="estado-vazio">
                <p className="estado-vazio-titulo">Nenhum lead capturado nessa janela.</p>
                <p className="estado-vazio-texto">
                  Escolha um período maior, ou confira na aba Config se a varredura da caixa de e-mail
                  está ativa.
                </p>
              </div>
            ) : (
              <>
                {/* Um gráfico por portal, mesma escala em todos: a identidade
                    vem da posição e do título, não de seis cores inventadas
                    que o AIOS não tem. */}
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
                  {serie.portais.map((p) => (
                    <SerieDoPortal
                      key={p.portal}
                      portal={p.portal}
                      pontos={p.pontos}
                      total={p.total}
                      maximo={serie.maximo}
                      primeiroDia={serie.dias[0]}
                      ultimoDia={serie.dias[serie.dias.length - 1]}
                    />
                  ))}
                </div>

                {/* A escala é compartilhada de propósito: é o que permite
                    comparar um portal com o outro de relance. */}
                <p className="text-[12px] text-aios-texto-suave">
                  {serie.portais.length > 1 ? "Mesma escala em todos os gráficos, de" : "Escala de"} 0 a{" "}
                  {serie.maximo} {serie.maximo === 1 ? "lead" : "leads"} por dia
                  {serie.dias.length > 1
                    ? `, de ${formatarDiaCurto(serie.dias[0])} a ${formatarDiaCurto(serie.dias[serie.dias.length - 1])}`
                    : ""}
                  .
                </p>

                <details className="border-t border-aios-borda pt-3">
                  <summary className="cursor-pointer text-[13px] font-medium text-aios-acao">
                    Ver os números dia a dia
                  </summary>
                  <div className="tabela-rolagem mt-3">
                    <table className="tabela min-w-[680px]">
                      <thead>
                        <tr>
                          <th scope="col">Dia</th>
                          {PORTAIS.map((portal) => (
                            <th key={portal} scope="col" className="numero-coluna">
                              {rotuloPortal(portal)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {serie.dias.map((dia) => (
                          <tr key={dia}>
                            <td className="whitespace-nowrap tabular-nums">{dia}</td>
                            {PORTAIS.map((portal) => (
                              <td key={portal} className="numero-coluna">
                                {serie.porDiaEPortal.get(`${dia}|${portal}`) ?? 0}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>
        </>
      )}

      {!carregando && !erro && !resposta && (
        <div className="estado-vazio">
          <p className="estado-vazio-titulo">Sem leads registrados ainda.</p>
          <p className="estado-vazio-texto">
            Assim que a primeira varredura da caixa de e-mail encontrar um lead, os números aparecem
            aqui.
          </p>
        </div>
      )}
    </section>
  );
}

function Indicador({ rotulo, valor, apoio }: { rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="cartao flex flex-col gap-0.5 p-3 sm:p-4">
      <p className="text-[13px] text-aios-texto-suave">{rotulo}</p>
      <p className="text-[28px] font-semibold leading-tight text-aios-texto">{valor}</p>
      {apoio && <p className="text-[12px] text-aios-texto-suave">{apoio}</p>}
    </div>
  );
}

/**
 * Série diária de um portal. Barra fina, topo arredondado e base reta, com
 * 2px de superfície separando as vizinhas (nunca uma borda em volta da
 * marca). Dia sem lead é uma lacuna de verdade, não um buraco no eixo: o
 * intervalo é preenchido dia a dia, então a forma do mês não mente.
 */
function SerieDoPortal({
  portal,
  pontos,
  total,
  maximo,
  primeiroDia,
  ultimoDia,
}: {
  portal: string;
  pontos: { dia: string; total: number }[];
  total: number;
  maximo: number;
  primeiroDia: string;
  ultimoDia: string;
}) {
  const fatia = LARGURA_SERIE / pontos.length;
  const respiro = pontos.length > 1 ? Math.min(2, fatia * 0.34) : 0;
  const largura = Math.max(1, fatia - respiro);
  const pico = pontos.reduce((maior, p) => (p.total > maior ? p.total : maior), 0);

  const descricao =
    `${rotuloPortal(portal)}: ${total} ${total === 1 ? "lead" : "leads"} entre ` +
    `${formatarDiaCurto(primeiroDia)} e ${formatarDiaCurto(ultimoDia)}, ` +
    `com pico de ${pico} em um dia.`;

  return (
    <figure className="m-0 flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-aios-texto">{rotuloPortal(portal)}</span>
        <span className="text-[12px] text-aios-texto-suave">
          {total} {total === 1 ? "lead" : "leads"}
        </span>
      </figcaption>

      <svg
        role="img"
        aria-label={descricao}
        viewBox={`0 0 ${LARGURA_SERIE} ${ALTURA_SERIE + 1}`}
        className="h-[57px] w-full"
        preserveAspectRatio="none"
      >
        {/* Grade recessiva: um fio no topo da escala e outro na base. */}
        <line x1="0" y1="0.5" x2={LARGURA_SERIE} y2="0.5" stroke="#E5E7EB" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line
          x1="0"
          y1={ALTURA_SERIE + 0.5}
          x2={LARGURA_SERIE}
          y2={ALTURA_SERIE + 0.5}
          stroke="#E5E7EB"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />

        {pontos.map((ponto, indice) => {
          if (ponto.total <= 0) return null;
          const altura = Math.max(2, (ponto.total / maximo) * ALTURA_SERIE);
          const x = indice * fatia + respiro / 2;
          return (
            <path
              key={ponto.dia}
              d={barraComTopoArredondado(x, ALTURA_SERIE - altura, largura, altura)}
              fill="#4F46E5"
            >
              <title>
                {formatarDiaCurto(ponto.dia)}: {ponto.total} {ponto.total === 1 ? "lead" : "leads"}
              </title>
            </path>
          );
        })}
      </svg>
    </figure>
  );
}

/** Topo arredondado, base reta: a barra nasce da linha de base. */
function barraComTopoArredondado(x: number, y: number, largura: number, altura: number): string {
  const raio = Math.min(RAIO_TOPO, largura / 2, altura);
  return [
    `M ${x} ${y + altura}`,
    `L ${x} ${y + raio}`,
    `Q ${x} ${y} ${x + raio} ${y}`,
    `L ${x + largura - raio} ${y}`,
    `Q ${x + largura} ${y} ${x + largura} ${y + raio}`,
    `L ${x + largura} ${y + altura}`,
    "Z",
  ].join(" ");
}

interface SerieMontada {
  dias: string[];
  maximo: number;
  porDiaEPortal: Map<string, number>;
  portais: { portal: string; total: number; pontos: { dia: string; total: number }[] }[];
}

/**
 * Do formato do endpoint (uma linha por dia e portal, só de dias com lead)
 * para o que o gráfico precisa: o eixo de dias completo, o máximo
 * compartilhado e um ponto por dia em cada portal que teve movimento.
 */
function montarSerie(serieDiaria: SerieDia[]): SerieMontada {
  const porDiaEPortal = new Map<string, number>();
  for (const s of serieDiaria) porDiaEPortal.set(`${s.data}|${s.portal}`, s.total);

  const datas = [...new Set(serieDiaria.map((s) => s.data))].sort();
  const dias = datas.length === 0 ? [] : intervaloDeDias(datas[0], datas[datas.length - 1]);

  let maximo = 1;
  for (const s of serieDiaria) if (s.total > maximo) maximo = s.total;

  const portais = PORTAIS.filter((portal) => serieDiaria.some((s) => s.portal === portal)).map((portal) => {
    const pontos = dias.map((dia) => ({ dia, total: porDiaEPortal.get(`${dia}|${portal}`) ?? 0 }));
    return { portal, total: pontos.reduce((soma, p) => soma + p.total, 0), pontos };
  });

  return { dias, maximo, porDiaEPortal, portais };
}

/** Teto de segurança: nenhuma janela do painel passa de 90 dias. */
const MAXIMO_DE_DIAS = 400;

function intervaloDeDias(inicio: string, fim: string): string[] {
  const comeco = Date.parse(`${inicio}T00:00:00Z`);
  const termino = Date.parse(`${fim}T00:00:00Z`);
  if (Number.isNaN(comeco) || Number.isNaN(termino) || termino < comeco) return [];

  const dias: string[] = [];
  for (let t = comeco; t <= termino && dias.length < MAXIMO_DE_DIAS; t += 86_400_000) {
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

function somarTotais(itens: NumeroPortal[]) {
  let total = 0;
  let revisao = 0;
  let identificados = 0;
  for (const item of itens) {
    total += item.total;
    revisao += item.revisao;
    identificados += item.taxa_identificacao * item.total;
  }
  return { total, revisao, taxa: total === 0 ? 0 : identificados / total };
}

function formatarInteiro(valor: number): string {
  return new Intl.NumberFormat("pt-BR").format(valor);
}

/** "2026-09-09" vira "09/09". O ano fica na legenda do eixo e na tabela. */
function formatarDiaCurto(dia: string): string {
  const partes = dia.split("-");
  return partes.length === 3 ? `${partes[2]}/${partes[1]}` : dia;
}

function formatarTempoContato(minutos: number | null): string {
  if (minutos === null) return "sem contato ainda";
  if (minutos < 60) return `${minutos}min`;
  const horas = Math.floor(minutos / 60);
  const resto = Math.round(minutos % 60);
  return resto === 0 ? `${horas}h` : `${horas}h${resto}min`;
}
