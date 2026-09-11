import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { buscarJson, mensagemDeErro } from "../lib/api";
import { rotuloPortal } from "../lib/portais";

interface EventoRevisao {
  id: number;
  portal: string;
  assunto: string | null;
  remetente: string | null;
  recebido_em: string | null;
  corpo_texto: string | null;
  corpo_html: string | null;
}

interface FormularioRevisao {
  nome: string;
  telefone: string;
  veiculo_texto: string;
  email: string;
  mensagem_lead: string;
}

const FORM_VAZIO: FormularioRevisao = {
  nome: "",
  telefone: "",
  veiculo_texto: "",
  email: "",
  mensagem_lead: "",
};

/**
 * A rede de segurança do sistema inteiro: quando o parser de um portal falha,
 * ou o telefone não pôde ser normalizado com segurança, o lead cai aqui em
 * vez de sumir. corpo_html é conteúdo de terceiro (o e-mail do portal), então
 * nunca pode ir solto no documento: só existe dentro de um <iframe sandbox>.
 */
export default function Revisao() {
  const [itens, setItens] = useState<EventoRevisao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [form, setForm] = useState<FormularioRevisao>(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    buscarJson<{ itens: EventoRevisao[] }>("/api/revisao")
      .then((resposta) => {
        if (!ativo) return;
        setItens(resposta.itens);
        setSelecionadoId(resposta.itens[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : "falha ao carregar a fila de revisão");
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, []);

  const selecionado = itens.find((item) => item.id === selecionadoId) ?? null;

  function selecionar(id: number) {
    setSelecionadoId(id);
    setForm(FORM_VAZIO);
    setErroEnvio(null);
  }

  async function completar(e: FormEvent) {
    e.preventDefault();
    if (!selecionado || enviando) return;

    setEnviando(true);
    setErroEnvio(null);
    try {
      const resposta = await fetch("/api/revisao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evento_id: selecionado.id, ...form }),
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemDeErro(corpo, "falha ao completar a revisão"));

      const restantes = itens.filter((item) => item.id !== selecionado.id);
      setItens(restantes);
      setSelecionadoId(restantes[0]?.id ?? null);
      setForm(FORM_VAZIO);
    } catch (erroAoCompletar) {
      setErroEnvio(erroAoCompletar instanceof Error ? erroAoCompletar.message : "falha ao completar a revisão");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="sr-only">Revisão</h1>

      <p className="tela-descricao">
        Leads que o parser ou a IA não conseguiram interpretar caem aqui, em vez de somem. Complete os
        dados a partir do e-mail original para o lead seguir para a ativação.
      </p>

      {erro && (
        <p role="alert" className="faixa-erro">
          <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
          Não foi possível carregar a fila de revisão: {erro}
        </p>
      )}

      {carregando && (
        <p className="carregando">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando fila de revisão...
        </p>
      )}

      {!carregando && !erro && itens.length === 0 && (
        <div className="estado-vazio">
          <Inbox aria-hidden="true" className="h-6 w-6 text-aios-texto-suave" />
          <p className="estado-vazio-titulo">Fila de revisão vazia, nenhum evento pendente.</p>
          <p className="estado-vazio-texto">
            Tudo que chegou foi interpretado sozinho. Os leads estão na aba Leads, prontos para o
            primeiro contato.
          </p>
        </div>
      )}

      {!carregando && itens.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[280px_1fr]">
          <ul className="cartao m-0 flex list-none flex-col overflow-hidden p-0">
            {itens.map((item) => (
              <li key={item.id} className="border-b border-aios-borda last:border-b-0">
                <button
                  type="button"
                  aria-current={item.id === selecionadoId ? "true" : undefined}
                  className={item.id === selecionadoId ? "item-fila item-fila-ativo" : "item-fila"}
                  onClick={() => selecionar(item.id)}
                >
                  <span className="selo self-start">{rotuloPortal(item.portal)}</span>
                  {/* Linha de prévia do item, em violeta: o detalhe que dá o
                      tom das listas do AIOS. */}
                  <span className="previa-linha line-clamp-2">{item.assunto ?? "sem assunto"}</span>
                </button>
              </li>
            ))}
          </ul>

          {selecionado && (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <div className="cartao flex flex-col overflow-hidden">
                <div className="flex flex-col gap-0.5 border-b border-aios-borda px-3 py-2.5">
                  <h2 className="text-[14px]">E-mail original</h2>
                  <p className="text-[12px] text-aios-texto-suave">
                    {selecionado.remetente ?? "remetente desconhecido"}
                    {selecionado.recebido_em ? `, ${formatarData(selecionado.recebido_em)}` : ""}
                  </p>
                </div>
                {/* corpo_html é conteúdo de terceiro, não confiável: sandbox
                    vazio (sem allow-scripts, allow-same-origin etc.) é o
                    nível mais restritivo, e é isso que impede o e-mail de
                    rodar script ou ler qualquer coisa desta aplicação. */}
                <iframe
                  title={`corpo do e-mail do evento ${selecionado.id}`}
                  sandbox=""
                  srcDoc={selecionado.corpo_html ?? selecionado.corpo_texto ?? ""}
                  className="h-[420px] w-full border-0 bg-white xl:h-[560px]"
                />
              </div>

              <form className="cartao flex flex-col gap-3 p-3 sm:p-4" onSubmit={completar}>
                <h2 className="text-[14px]">Completar lead</h2>

                <div className="campo">
                  <label className="rotulo" htmlFor="revisao-nome">
                    Nome
                  </label>
                  <input
                    id="revisao-nome"
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>

                <div className="campo">
                  <label className="rotulo" htmlFor="revisao-telefone">
                    Telefone
                  </label>
                  <input
                    id="revisao-telefone"
                    value={form.telefone}
                    onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                  />
                </div>

                <div className="campo">
                  <label className="rotulo" htmlFor="revisao-veiculo">
                    Veículo
                  </label>
                  <input
                    id="revisao-veiculo"
                    value={form.veiculo_texto}
                    onChange={(e) => setForm({ ...form, veiculo_texto: e.target.value })}
                  />
                </div>

                <div className="campo">
                  <label className="rotulo" htmlFor="revisao-email">
                    E-mail
                  </label>
                  <input
                    id="revisao-email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>

                <div className="campo">
                  <label className="rotulo" htmlFor="revisao-mensagem">
                    Mensagem do lead
                  </label>
                  <textarea
                    id="revisao-mensagem"
                    value={form.mensagem_lead}
                    onChange={(e) => setForm({ ...form, mensagem_lead: e.target.value })}
                  />
                </div>

                {erroEnvio && (
                  <p role="alert" className="faixa-erro">
                    <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
                    {erroEnvio}
                  </p>
                )}

                <button type="submit" className="botao botao-primario botao-grande" disabled={enviando}>
                  {enviando && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
                  {enviando ? "Salvando..." : "Completar revisão"}
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Data curta, em pt-BR. Se vier algo que não é data, mostra o valor cru. */
function formatarData(valor: string): string {
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return valor;
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
