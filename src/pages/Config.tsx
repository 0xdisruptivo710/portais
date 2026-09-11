import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, Power, TriangleAlert } from "lucide-react";
import { mensagemDeErro } from "../lib/api";

interface ConfigCliente {
  texto_boas_vindas: string;
  horario_inicio: string;
  horario_fim: string;
  modo_envio: "dry_run" | "real";
  kill_switch: boolean;
}

const FRASE_CONFIRMACAO = "ENVIAR DE VERDADE";

/**
 * A tela de configuração é a que carrega o kill-switch e o modo de envio.
 * A assimetria é proposital: ligar o envio real exige digitar a frase de
 * confirmação; parar tudo (kill-switch) é um clique só. O freio nunca pode
 * ser mais difícil de acionar do que o acelerador.
 *
 * A tela desenha essa assimetria: o freio fica no topo, sozinho, alcançável
 * de qualquer lugar da página; o acelerador fica no fim do formulário, num
 * bloco destacado que diz o que vai acontecer antes de acontecer.
 */
export default function Config() {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [textoBoasVindas, setTextoBoasVindas] = useState("");
  const [horarioInicio, setHorarioInicio] = useState("");
  const [horarioFim, setHorarioFim] = useState("");
  const [modoOriginal, setModoOriginal] = useState<"dry_run" | "real">("dry_run");
  const [envioRealMarcado, setEnvioRealMarcado] = useState(false);
  const [frase, setFrase] = useState("");
  const [killSwitch, setKillSwitch] = useState(false);

  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    fetch("/api/config")
      .then((resposta) => resposta.json())
      .then((dados: ConfigCliente) => {
        if (!ativo) return;
        setTextoBoasVindas(dados.texto_boas_vindas ?? "");
        setHorarioInicio((dados.horario_inicio ?? "").slice(0, 5));
        setHorarioFim((dados.horario_fim ?? "").slice(0, 5));
        const modo = dados.modo_envio === "real" ? "real" : "dry_run";
        setModoOriginal(modo);
        setEnvioRealMarcado(modo === "real");
        setKillSwitch(Boolean(dados.kill_switch));
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : "falha ao carregar a configuração");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  // Só exige a frase quando o usuário está de fato ligando o envio real
  // nesta sessão. Se já veio "real" do servidor, editar outro campo não
  // reabre a exigência a cada salvamento.
  const precisaConfirmar = envioRealMarcado && modoOriginal !== "real";
  const podeSalvar = !precisaConfirmar || frase === FRASE_CONFIRMACAO;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!podeSalvar || salvando) return;

    setSalvando(true);
    setErroSalvar(null);
    setMensagem(null);
    const modoEnvio = envioRealMarcado ? "real" : "dry_run";

    try {
      const resposta = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          texto_boas_vindas: textoBoasVindas,
          horario_inicio: horarioInicio,
          horario_fim: horarioFim,
          modo_envio: modoEnvio,
        }),
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemDeErro(corpo, "falha ao salvar a configuração"));

      setModoOriginal(modoEnvio);
      setFrase("");
      setMensagem("Configuração salva.");
    } catch (erroAoSalvar) {
      setErroSalvar(erroAoSalvar instanceof Error ? erroAoSalvar.message : "falha ao salvar a configuração");
    } finally {
      setSalvando(false);
    }
  }

  // Deliberadamente fora do form de "Salvar": um clique aqui já dispara o
  // PUT, sem frase de confirmação e sem depender de outro botão.
  async function pararOuRetomar() {
    setErroSalvar(null);
    setMensagem(null);
    const novoValor = !killSwitch;

    try {
      const resposta = await fetch("/api/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kill_switch: novoValor }),
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemDeErro(corpo, "falha ao atualizar o kill-switch"));

      setKillSwitch(novoValor);
      setMensagem(novoValor ? "Envio parado." : "Envio retomado.");
    } catch (erroKillSwitch) {
      setErroSalvar(erroKillSwitch instanceof Error ? erroKillSwitch.message : "falha ao atualizar o kill-switch");
    }
  }

  if (carregando) {
    return (
      <p className="carregando">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Carregando configuração...
      </p>
    );
  }

  if (erro) {
    return (
      <p role="alert" className="faixa-erro">
        <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
        Não foi possível carregar a configuração: {erro}
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="sr-only">Configuração</h1>

      {/* O freio, no topo e sozinho: um clique para e um clique retoma. */}
      <div className="cartao flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="rotulo">Modo de envio atual</p>
            <p>
              <span className={modoOriginal === "real" ? "selo selo-atencao" : "selo"}>{modoOriginal}</span>
            </p>
            <p className="dica max-w-[46ch]">
              {modoOriginal === "real"
                ? "Cada confirmação na aba Leads manda mensagem de verdade para o cliente."
                : "Simulação. O envio é registrado no lead, mas nenhuma mensagem chega ao cliente."}
            </p>
          </div>

          <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:items-end">
            <p className="rotulo">Kill-switch</p>
            <p className="text-[13px] text-aios-texto-suave">
              {killSwitch ? "ligado, nada sai" : "desligado"}
            </p>
            <button
              type="button"
              className={killSwitch ? "botao botao-primario botao-grande" : "botao botao-perigo botao-grande"}
              onClick={pararOuRetomar}
            >
              <Power aria-hidden="true" className="h-4 w-4" />
              {killSwitch ? "Retomar envio" : "Parar tudo"}
            </button>
          </div>
        </div>

        {killSwitch ? (
          <p className="faixa-atencao">
            <TriangleAlert aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            Envio parado. Nenhuma mensagem sai enquanto o kill-switch estiver ligado, nem em simulação.
          </p>
        ) : modoOriginal === "real" ? (
          <p className="faixa-info">
            <Info aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            Envio real ligado. Um clique em Parar tudo interrompe na hora, sem confirmação nenhuma.
          </p>
        ) : null}

        {erroSalvar && (
          <p role="alert" className="faixa-erro">
            <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            {erroSalvar}
          </p>
        )}
        {mensagem && (
          <p role="status" className="faixa-ok">
            <CheckCircle2 aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            {mensagem}
          </p>
        )}
      </div>

      <form className="cartao flex max-w-[760px] flex-col gap-4 p-4" onSubmit={salvar}>
        <div className="campo">
          <label className="rotulo" htmlFor="config-boas-vindas">
            Texto de boas-vindas
          </label>
          <textarea
            id="config-boas-vindas"
            value={textoBoasVindas}
            onChange={(e) => setTextoBoasVindas(e.target.value)}
          />
          <p className="dica">
            É o primeiro contato que o lead recebe. Vale conferir a prévia na aba Leads antes de salvar.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="campo">
            <label className="rotulo" htmlFor="config-horario-inicio">
              Janela de horário, início
            </label>
            <input
              id="config-horario-inicio"
              type="time"
              className="max-w-[160px]"
              value={horarioInicio}
              onChange={(e) => setHorarioInicio(e.target.value)}
            />
          </div>

          <div className="campo">
            <label className="rotulo" htmlFor="config-horario-fim">
              Janela de horário, fim
            </label>
            <input
              id="config-horario-fim"
              type="time"
              className="max-w-[160px]"
              value={horarioFim}
              onChange={(e) => setHorarioFim(e.target.value)}
            />
          </div>
        </div>

        {/* O acelerador. Bloco próprio, moldura de atenção e a frase de
            confirmação: ligar o envio real é uma decisão, não um clique de
            passagem. O freio lá em cima continua a um clique. */}
        <div className="flex flex-col gap-3 rounded-aios border border-amber-300 bg-aios-atencao-fundo p-3">
          <h2 className="text-[14px] text-aios-atencao-texto">Envio real</h2>
          <p className="text-[13px] text-aios-atencao-texto">
            Com o envio real ligado, cada confirmação na aba Leads manda uma mensagem de WhatsApp para
            um cliente de verdade. Não tem desfazer.
          </p>

          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-aios-atencao-texto" htmlFor="config-envio-real">
            <input
              id="config-envio-real"
              type="checkbox"
              checked={envioRealMarcado}
              onChange={(e) => setEnvioRealMarcado(e.target.checked)}
            />
            Ativar envio real
          </label>

          {precisaConfirmar && (
            <div className="campo">
              <label className="rotulo text-aios-atencao-texto" htmlFor="config-confirma">
                Frase de confirmação, digite {FRASE_CONFIRMACAO}
              </label>
              <input
                id="config-confirma"
                className="max-w-[280px]"
                value={frase}
                onChange={(e) => setFrase(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="botao botao-primario botao-grande"
            disabled={!podeSalvar || salvando}
          >
            {salvando && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Salvar
          </button>
          {!podeSalvar && (
            <p className="dica">Digite a frase acima, exatamente como está escrita, para liberar.</p>
          )}
        </div>
      </form>
    </section>
  );
}
