import { useState, type FormEvent } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { chamarApi, mensagemDeErro } from "../lib/api";

export interface EventoRevisao {
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

interface Props {
  evento: EventoRevisao;
  /** Chamado só depois de o servidor confirmar a gravação do lead. */
  aoCompletar: () => void;
}

/**
 * A rede de segurança do sistema, agora dentro da lista de Leads.
 *
 * Quando nem o parser nem a IA conseguem ler o e-mail, o item cai na fila de
 * revisão em vez de sumir. A aba própria saiu da navegação a pedido do
 * operador, mas a fila não podia sair junto: sem ela, "perder lead é
 * impossível por construção" deixaria de ser verdade. Este painel é a fila,
 * aberta na própria linha do item.
 *
 * corpo_html é conteúdo de terceiro (o e-mail do portal), então nunca pode ir
 * solto no documento: só existe dentro de um <iframe sandbox>.
 */
export default function PainelRevisao({ evento, aoCompletar }: Props) {
  const [form, setForm] = useState<FormularioRevisao>(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function completar(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;

    setEnviando(true);
    setErro(null);
    try {
      const resposta = await chamarApi("/api/revisao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evento_id: evento.id, ...form }),
      });
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(mensagemDeErro(corpo, "falha ao completar a revisão"));
      // Só aqui: o item sai da fila depois de o lead estar gravado, nunca
      // antes. Sumir da tela com o erro na mão seria perder o lead de vez.
      aoCompletar();
    } catch (erroAoCompletar) {
      setErro(erroAoCompletar instanceof Error ? erroAoCompletar.message : "falha ao completar a revisão");
    } finally {
      setEnviando(false);
    }
  }

  // Os ids carregam o id do evento porque mais de uma linha pode estar aberta
  // e id repetido no documento quebra a associação do label com o campo.
  const id = (campo: string) => `revisao-${campo}-${evento.id}`;

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <div className="cartao flex flex-col overflow-hidden">
        <div className="flex flex-col gap-0.5 border-b border-aios-borda px-3 py-2.5">
          <h3 className="text-[14px]">E-mail original</h3>
          <p className="text-[12px] text-aios-texto-suave">
            {evento.remetente ?? "remetente desconhecido"}
            {evento.recebido_em ? `, ${formatarData(evento.recebido_em)}` : ""}
          </p>
        </div>
        {/* sandbox vazio (sem allow-scripts, allow-same-origin etc.) é o nível
            mais restritivo, e é o que impede o e-mail de rodar script ou ler
            qualquer coisa desta aplicação. */}
        <iframe
          title={`corpo do e-mail do evento ${evento.id}`}
          sandbox=""
          srcDoc={evento.corpo_html ?? evento.corpo_texto ?? ""}
          className="h-[360px] w-full border-0 bg-white xl:h-[440px]"
        />
      </div>

      <form className="cartao flex flex-col gap-3 p-3 sm:p-4" onSubmit={completar}>
        <h3 className="text-[14px]">Completar lead</h3>
        <p className="text-[12px] text-aios-texto-suave">
          Copie do e-mail ao lado o que o sistema não conseguiu ler. O lead entra na lista com os dados
          que você digitar e segue para o primeiro contato.
        </p>

        <div className="campo">
          <label className="rotulo" htmlFor={id("nome")}>
            Nome
          </label>
          <input
            id={id("nome")}
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
          />
        </div>

        <div className="campo">
          <label className="rotulo" htmlFor={id("telefone")}>
            Telefone
          </label>
          <input
            id={id("telefone")}
            value={form.telefone}
            onChange={(e) => setForm({ ...form, telefone: e.target.value })}
          />
        </div>

        <div className="campo">
          <label className="rotulo" htmlFor={id("veiculo")}>
            Veículo
          </label>
          <input
            id={id("veiculo")}
            value={form.veiculo_texto}
            onChange={(e) => setForm({ ...form, veiculo_texto: e.target.value })}
          />
        </div>

        <div className="campo">
          <label className="rotulo" htmlFor={id("email")}>
            E-mail
          </label>
          <input
            id={id("email")}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>

        <div className="campo">
          <label className="rotulo" htmlFor={id("mensagem")}>
            Mensagem do lead
          </label>
          <textarea
            id={id("mensagem")}
            value={form.mensagem_lead}
            onChange={(e) => setForm({ ...form, mensagem_lead: e.target.value })}
          />
        </div>

        {erro && (
          <p role="alert" className="faixa-erro">
            <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            {erro}
          </p>
        )}

        <button type="submit" className="botao botao-primario botao-grande" disabled={enviando}>
          {enviando && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          {enviando ? "Salvando..." : "Completar revisão"}
        </button>
      </form>
    </div>
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
