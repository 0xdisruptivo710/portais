import { useRef, useState } from "react";
import { AlertCircle, AlertTriangle, Ban, CheckCircle2, Clock, Loader2, Send, Square } from "lucide-react";
import { chamarApi, mensagemDeErro } from "../lib/api";

type Situacao = "enviado" | "bloqueado" | "falhou";

interface ResultadoLead {
  lead_id: number;
  situacao: Situacao;
  motivo: string | null;
  verificado: boolean;
  verificacao_detalhe: string | null;
}

interface Fatia {
  resultados: ResultadoLead[];
  restantes: number[];
  parado: null | "fatia" | "prazo" | "fora_da_janela";
}

interface Previa {
  selecionados: number;
  no_lote: number;
  acima_do_teto: number;
  teto: number;
  ids: number[];
  vao_sair: number;
  pessoas: number;
  repetidos: number;
  bloqueados: number;
  motivos: { motivo: string; quantidade: number }[];
  pausa_segundos: number;
  janela: { aberta: boolean; inicio: string; fim: string };
  conversa_wts_confere_no_envio: boolean;
}

interface Props {
  /** Ids dos leads selecionados, na ordem em que aparecem na tela. */
  ids: number[];
  /** O filtro que está valendo, em palavras, para a confirmação citar. */
  descricaoFiltro: string;
  aoResultado: (leadId: number, situacao: Situacao) => void;
  aoLimparSelecao: () => void;
}

type Fase = "parado" | "confirmando" | "enviando" | "fim";

/**
 * O envio em lote. É a parte mais perigosa do painel: daqui saem dezenas de
 * mensagens de WhatsApp para clientes reais, e não existe desfazer.
 *
 * O desenho inteiro é feito de freios:
 *
 * 1. Nada sai sem duas ações. A primeira abre a confirmação, que não pergunta
 *    "tem certeza?" e sim mostra o número: quantas mensagens saem, para
 *    quantas pessoas distintas, quantas já estão bloqueadas e por quê. A
 *    segunda é que dispara.
 * 2. A confirmação cita o filtro em palavras. "Todos" nunca quer dizer a base
 *    inteira: quer dizer o que o filtro está mostrando, e isso não pode ficar
 *    subentendido.
 * 3. O envio é uma emenda de requisições curtas, e não uma só. A function da
 *    Vercel morre aos 300s e o lote com espaçamento dura muito mais que isso.
 *    Cada requisição devolve o que sobrou, e esta tela pede a próxima. Parar é
 *    simplesmente não pedir.
 * 4. O que aparece no fim é a verdade lead a lead: enviado, bloqueado com o
 *    motivo, ou falhou com o erro. "Enviada" e "entrega confirmada" são duas
 *    frases diferentes aqui, porque o WTS responde QUEUED em mensagem que
 *    nunca chega.
 */
export default function EnvioEmLote({ ids, descricaoFiltro, aoResultado, aoLimparSelecao }: Props) {
  const [fase, setFase] = useState<Fase>("parado");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultados, setResultados] = useState<ResultadoLead[]>([]);
  const [restantes, setRestantes] = useState<number[]>([]);
  const [total, setTotal] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  // Ref, e não estado: o laço assíncrono lê o valor a cada volta, e um estado
  // ficaria congelado no valor que existia quando o laço começou.
  const parar = useRef(false);

  async function abrirConfirmacao() {
    setCarregando(true);
    setErro(null);
    setAviso(null);
    try {
      const resposta = await chamarApi("/api/lote/previa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds: ids }),
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemDeErro(corpo, "falha ao montar a prévia do lote"));
      setPrevia(corpo as Previa);
      setFase("confirmando");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao montar a prévia do lote");
    } finally {
      setCarregando(false);
    }
  }

  /**
   * O laço que emenda as fatias. Cada volta manda o que falta e recebe de
   * volta o que sobrou. Se a requisição morrer, o que falta continua na tela
   * e o botão de retomar manda exatamente a mesma lista: quem já recebeu é
   * pulado no servidor pelo `enviado_em` do próprio lead, não por contador
   * nenhum daqui.
   */
  async function disparar(fila: number[]) {
    parar.current = false;
    setFase("enviando");
    setErro(null);
    setAviso(null);

    let pendentes = fila;
    while (pendentes.length > 0) {
      let fatia: Fatia;
      try {
        const resposta = await chamarApi("/api/lote/enviar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadIds: pendentes }),
        });
        const corpo = await resposta.json().catch(() => null);
        if (!resposta.ok) throw new Error(mensagemDeErro(corpo, "falha no envio do lote"));
        fatia = corpo as Fatia;
      } catch (e) {
        // O resto não se perde: fica na tela, para retomar.
        setRestantes(pendentes);
        setErro(e instanceof Error ? e.message : "falha no envio do lote");
        setFase("fim");
        return;
      }

      for (const resultado of fatia.resultados) aoResultado(resultado.lead_id, resultado.situacao);
      setResultados((anteriores) => [...anteriores, ...fatia.resultados]);
      pendentes = fatia.restantes;
      setRestantes(pendentes);

      if (fatia.parado === "fora_da_janela") {
        setAviso(
          `O lote parou porque está fora do horário de envio combinado. Retome dentro da janela e quem já recebeu não recebe de novo.`,
        );
        setFase("fim");
        return;
      }

      // A interrupção acontece entre fatias: as mensagens da fatia em curso
      // já estão a caminho, e não existe como chamá-las de volta.
      if (parar.current && pendentes.length > 0) {
        setAviso("Lote interrompido por você.");
        setFase("fim");
        return;
      }
    }

    setFase("fim");
  }

  function fechar() {
    setFase("parado");
    setPrevia(null);
    setResultados([]);
    setRestantes([]);
    setErro(null);
    setAviso(null);
    aoLimparSelecao();
  }

  const enviados = resultados.filter((r) => r.situacao === "enviado").length;
  const bloqueados = resultados.filter((r) => r.situacao === "bloqueado").length;
  const falhas = resultados.filter((r) => r.situacao === "falhou").length;

  if (fase === "parado") {
    return (
      <div className="cartao flex flex-wrap items-center justify-between gap-3 p-3">
        <p className="text-[13px] font-medium text-aios-texto">
          {ids.length === 1 ? "1 selecionado" : `${ids.length} selecionados`}
          {/* De onde veio a seleção, sempre à vista: é o que impede "todos" de
              ser lido como "a base inteira". */}
          <span className="ml-2 font-normal text-aios-texto-suave">de {descricaoFiltro}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {erro && (
            <p role="alert" className="faixa-erro">
              <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
              {erro}
            </p>
          )}
          <button type="button" className="botao" onClick={aoLimparSelecao}>
            Limpar seleção
          </button>
          <button
            type="button"
            className="botao botao-primario"
            onClick={abrirConfirmacao}
            disabled={carregando}
          >
            {carregando ? (
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send aria-hidden="true" className="h-3.5 w-3.5" />
            )}
            {carregando ? "Conferindo..." : "Enviar para os selecionados"}
          </button>
        </div>
      </div>
    );
  }

  if (fase === "confirmando" && previa) {
    return (
      <div className="cartao flex flex-col gap-3 border-aios-acao p-3 sm:p-4">
        <h2 className="text-[14px]">Confirmar envio em lote</h2>

        <p className="text-[13px] text-aios-texto-suave">
          Selecionados a partir do filtro: <strong className="text-aios-texto">{descricaoFiltro}</strong>. O
          lote não usa a base inteira, só o que este filtro mostra.
        </p>

        {/* O número, grande, antes de qualquer botão. É o que o operador tem
            que olhar, e a confirmação existe por causa dele. */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Numero valor={previa.vao_sair} rotulo={previa.vao_sair === 1 ? "mensagem vai sair" : "mensagens vão sair"} />
          <Numero valor={previa.pessoas} rotulo={previa.pessoas === 1 ? "pessoa distinta" : "pessoas distintas"} />
          <Numero
            valor={previa.bloqueados}
            rotulo={previa.bloqueados === 1 ? "já está bloqueado" : "já estão bloqueados"}
          />
        </div>

        {previa.repetidos > 0 && (
          <p className="text-[12px] text-aios-texto-suave">
            {previa.repetidos === 1
              ? "1 lead selecionado é da mesma pessoa que outro: a janela de recontato vai suprimir o repetido."
              : `${previa.repetidos} leads selecionados são da mesma pessoa que outros: a janela de recontato vai suprimir os repetidos.`}
          </p>
        )}

        {previa.motivos.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px] text-aios-texto-suave">
            {previa.motivos.map((m) => (
              <li key={m.motivo}>
                {m.quantidade} por: {m.motivo}
              </li>
            ))}
          </ul>
        )}

        {previa.acima_do_teto > 0 && (
          <p role="alert" className="faixa-atencao">
            <AlertTriangle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            Você selecionou {previa.selecionados}. Este lote leva {previa.no_lote}, que é o teto por vez;{" "}
            {previa.acima_do_teto} ficam para o próximo lote.
          </p>
        )}

        {!previa.janela.aberta && (
          <p role="alert" className="faixa-atencao">
            <Clock aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            Agora está fora do horário de envio ({previa.janela.inicio} às {previa.janela.fim}). O lote não vai
            começar enquanto a janela estiver fechada.
          </p>
        )}

        <p className="text-[12px] text-aios-texto-suave">
          As mensagens saem uma a uma, com {previa.pausa_segundos} segundos entre elas: disparar tudo de uma
          vez estoura o limite do WTS e é padrão de bloqueio no WhatsApp. Você pode parar no meio, e o que já
          saiu não volta.
        </p>

        {previa.conversa_wts_confere_no_envio && (
          <p className="text-[12px] text-aios-texto-suave">
            A conversa aberta no WTS é conferida lead a lead na hora do envio, não aqui: quem já estiver
            negociando com a equipe é pulado e aparece no resultado.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="botao botao-primario botao-grande"
            onClick={() => {
              setTotal(previa.ids.length);
              setResultados([]);
              disparar(previa.ids);
            }}
            disabled={previa.ids.length === 0}
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            Confirmar envio de {previa.vao_sair === 1 ? "1 mensagem" : `${previa.vao_sair} mensagens`}
          </button>
          <button type="button" className="botao" onClick={() => setFase("parado")}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (fase === "enviando") {
    const feitos = resultados.length;
    return (
      <div className="cartao flex flex-col gap-3 border-aios-acao p-3 sm:p-4">
        <h2 className="text-[14px]">Enviando o lote</h2>
        <p role="status" className="flex items-center gap-2 text-[13px] text-aios-texto">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          {feitos} de {total} processados: {enviados} enviados, {bloqueados} bloqueados, {falhas} com falha.
        </p>
        <p className="text-[12px] text-aios-texto-suave">
          Parar tem efeito no fim do bloco em andamento: as mensagens que já saíram não voltam.
        </p>
        <button
          type="button"
          className="botao botao-perigo self-start"
          onClick={() => {
            parar.current = true;
          }}
        >
          <Square aria-hidden="true" className="h-3.5 w-3.5" />
          Parar
        </button>
      </div>
    );
  }

  return (
    <div className="cartao flex flex-col gap-3 p-3 sm:p-4">
      <h2 className="text-[14px]">{aviso ? "Lote interrompido" : "Lote concluído"}</h2>

      <p className="text-[13px] text-aios-texto">
        {enviados} enviados, {bloqueados} bloqueados, {falhas} com falha.
      </p>

      {/* O retorno do envio não prova entrega. Só a conferência prova, e ela
          roda segundos depois do envio, quando o normal ainda é QUEUED. */}
      {enviados > 0 && (
        <p className="text-[12px] text-aios-texto-suave">
          Entrega ainda não confirmada para essas mensagens: o WTS aceitou o envio, o que é diferente de a
          pessoa ter recebido.
        </p>
      )}

      {aviso && (
        <p role="alert" className="faixa-atencao">
          <AlertTriangle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
          {aviso}
        </p>
      )}

      {erro && (
        <p role="alert" className="faixa-erro">
          <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
          {erro}
        </p>
      )}

      {restantes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] text-aios-texto-suave">
            {restantes.length === 1 ? "1 ficou de fora" : `${restantes.length} ficaram de fora`} do que foi
            confirmado. Retomar não repete quem já recebeu.
          </p>
          <button type="button" className="botao botao-primario" onClick={() => disparar(restantes)}>
            Retomar com os {restantes.length}
          </button>
        </div>
      )}

      {resultados.length > 0 && (
        <ul className="m-0 flex max-h-[240px] list-none flex-col gap-1 overflow-auto p-0 text-[12px]">
          {resultados.map((r) => (
            <li key={r.lead_id} className="flex items-start gap-2 border-b border-aios-borda py-1 last:border-b-0">
              <IconeSituacao situacao={r.situacao} />
              <span className="text-aios-texto-suave">
                Lead {r.lead_id}:{" "}
                {r.situacao === "enviado"
                  ? `mensagem enviada. Entrega não confirmada: ${r.verificacao_detalhe ?? "não foi possível conferir"}`
                  : r.situacao === "bloqueado"
                    ? `não enviado. Motivo: ${r.motivo ?? "sem motivo registrado"}`
                    : `falhou: ${r.motivo ?? "erro sem mensagem"}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="botao self-start" onClick={fechar}>
        Fechar
      </button>
    </div>
  );
}

function Numero({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <div className="rounded-aios border border-aios-borda bg-aios-fundo px-3 py-2">
      <p className="text-[20px] font-semibold tabular-nums text-aios-texto">
        {valor} <span className="text-[13px] font-medium text-aios-texto-suave">{rotulo}</span>
      </p>
    </div>
  );
}

function IconeSituacao({ situacao }: { situacao: Situacao }) {
  if (situacao === "enviado") {
    return <CheckCircle2 aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-aios-ok-texto" />;
  }
  if (situacao === "bloqueado") {
    return <Ban aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-aios-atencao-texto" />;
  }
  return <AlertTriangle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0 text-aios-erro-texto" />;
}
