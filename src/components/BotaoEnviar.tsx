import { useState } from "react";
import { AlertCircle, AlertTriangle, Ban, CheckCircle2, Loader2, Send } from "lucide-react";
import { mensagemDeErro } from "../lib/api";

interface Previa {
  texto: string;
  telefone_exibicao: string | null;
  para: string | null;
  bloqueado: boolean;
  motivo: string | null;
  ultimo_contato_em: string | null;
  dias_desde_ultimo_contato: number | null;
}

interface ResultadoEnvio {
  acao: string;
  enviado: boolean;
  motivo: string | null;
  verificado: boolean;
  verificacao_detalhe: string | null;
}

interface Props {
  leadId: number;
  /** Recebe o novo status_ativacao do lead para a linha refletir sem recarregar. */
  aoEnviar: (statusAtivacao: string) => void;
}

/**
 * O botão que manda a mensagem de verdade para um cliente real. Ele é a
 * autorização humana daquele envio, e por isso nunca dispara direto: abre a
 * confirmação, que mostra o texto EXATO que vai sair (vindo do servidor, da
 * mesma preparação que faz o envio) e para qual número.
 *
 * O que esta tela não pode fazer, em nenhum caminho: dizer que a mensagem
 * chegou. O WTS responde ao envio mesmo em mensagem que nunca é entregue, e
 * por isso "enviada" e "entrega confirmada" são duas frases diferentes aqui.
 *
 * Um lead por vez, de propósito. Não existe envio em lote nesta tela.
 */
export default function BotaoEnviar({ leadId, aoEnviar }: Props) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function abrir() {
    setCarregando(true);
    setErro(null);
    setResultado(null);
    try {
      const resposta = await fetch(`/api/enviar?leadId=${leadId}`);
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemDeErro(corpo, "falha ao carregar a prévia do envio"));
      setPrevia(corpo as Previa);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao carregar a prévia do envio");
    } finally {
      setCarregando(false);
    }
  }

  async function confirmar() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/enviar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemDeErro(corpo, "falha ao enviar a mensagem"));

      const recebido = corpo as ResultadoEnvio;
      setResultado(recebido);
      setPrevia(null);
      // A linha da lista passa a mostrar o estado real sem recarregar a página.
      aoEnviar(recebido.enviado ? "enviado" : "suprimido");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "falha ao enviar a mensagem");
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <div className="flex min-w-[220px] flex-col gap-1">
        {resultado.enviado ? (
          <>
            <p role="status" className="faixa-ok">
              <CheckCircle2 aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
              Mensagem enviada.
            </p>
            {/* O retorno do envio não prova entrega. Só a conferência prova, e
                quando ela não conclui a tela diz isso com todas as letras.
                Por isso fica em tom de rodapé, nunca com o verde do sucesso. */}
            <p className="text-[12px] text-aios-texto-suave">
              {resultado.verificado
                ? `Entrega confirmada: ${resultado.verificacao_detalhe ?? "sem detalhe"}`
                : `Entrega ainda não confirmada: ${resultado.verificacao_detalhe ?? "não foi possível conferir"}`}
            </p>
          </>
        ) : (
          <p role="alert" className="faixa-atencao">
            <Ban aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            Não enviado. Motivo: {resultado.motivo ?? "sem motivo registrado"}
          </p>
        )}
      </div>
    );
  }

  if (!previa) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" className="botao botao-primario" onClick={abrir} disabled={carregando}>
          {carregando ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {carregando ? "Carregando..." : "Enviar"}
        </button>
        {erro && (
          <p role="alert" className="faixa-erro">
            <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            {erro}
          </p>
        )}
      </div>
    );
  }

  return (
    /* A confirmação vive dentro da célula da tabela, então precisa de largura
     * mínima própria: o texto que vai sair tem que ser legível inteiro antes
     * de o operador confirmar, e não espremido em uma coluna estreita. */
    <div className="cartao flex min-w-[340px] max-w-[420px] flex-col gap-2.5 border-aios-acao p-3">
      <h3 className="text-[14px]">Confirmar envio</h3>

      <p className="text-[13px] text-aios-texto-suave">
        Para: <strong className="font-semibold tabular-nums text-aios-texto">{previa.telefone_exibicao ?? previa.para ?? "sem telefone"}</strong>
      </p>

      {/* Prévia do que sai: violeta e com barra lateral, o mesmo tratamento
          que o AIOS dá à linha de resumo de um item. */}
      <p className="whitespace-pre-wrap rounded-aios border-l-[3px] border-aios-previa bg-aios-fundo px-3 py-2 text-[13px] text-aios-previa">
        {previa.texto}
      </p>

      {previa.dias_desde_ultimo_contato !== null && (
        <p role="alert" className="faixa-atencao">
          <AlertTriangle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
          Atenção: esse telefone já recebeu mensagem {rotuloRecencia(previa.dias_desde_ultimo_contato)}.
        </p>
      )}

      {previa.bloqueado && (
        <p role="alert" className="faixa-atencao">
          <Ban aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
          Este envio vai ser suprimido: {previa.motivo ?? "motivo não informado"}. Confirmar registra a
          tentativa, mas nenhuma mensagem sai.
        </p>
      )}

      {erro && (
        <p role="alert" className="faixa-erro">
          <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
          {erro}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="botao botao-primario" onClick={confirmar} disabled={enviando}>
          {enviando && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
          {enviando ? "Enviando..." : "Confirmar envio"}
        </button>
        <button type="button" className="botao" onClick={() => setPrevia(null)} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function rotuloRecencia(dias: number): string {
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}
