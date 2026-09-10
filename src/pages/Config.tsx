import { useEffect, useState, type FormEvent } from "react";
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

  if (carregando) return <p>Carregando configuração...</p>;
  if (erro) return <p role="alert">Não foi possível carregar a configuração: {erro}</p>;

  return (
    <section>
      <h1>Configuração</h1>

      <p>
        Modo de envio atual: <strong>{modoOriginal}</strong>
      </p>

      <p>
        Kill-switch: <strong>{killSwitch ? "ligado, nada sai" : "desligado"}</strong>
      </p>
      <button type="button" onClick={pararOuRetomar}>
        {killSwitch ? "Retomar envio" : "Parar tudo"}
      </button>

      <form onSubmit={salvar}>
        <div>
          <label htmlFor="config-boas-vindas">Texto de boas-vindas</label>
          <textarea
            id="config-boas-vindas"
            value={textoBoasVindas}
            onChange={(e) => setTextoBoasVindas(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="config-horario-inicio">Janela de horário, início</label>
          <input
            id="config-horario-inicio"
            type="time"
            value={horarioInicio}
            onChange={(e) => setHorarioInicio(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="config-horario-fim">Janela de horário, fim</label>
          <input
            id="config-horario-fim"
            type="time"
            value={horarioFim}
            onChange={(e) => setHorarioFim(e.target.value)}
          />
        </div>

        <div>
          <label htmlFor="config-envio-real">
            <input
              id="config-envio-real"
              type="checkbox"
              checked={envioRealMarcado}
              onChange={(e) => setEnvioRealMarcado(e.target.checked)}
            />
            {" "}Ativar envio real
          </label>
        </div>

        {precisaConfirmar && (
          <div>
            <label htmlFor="config-confirma">Frase de confirmação, digite {FRASE_CONFIRMACAO}</label>
            <input id="config-confirma" value={frase} onChange={(e) => setFrase(e.target.value)} />
          </div>
        )}

        {erroSalvar && <p role="alert">{erroSalvar}</p>}
        {mensagem && <p role="status">{mensagem}</p>}

        <button type="submit" disabled={!podeSalvar || salvando}>
          Salvar
        </button>
      </form>
    </section>
  );
}
