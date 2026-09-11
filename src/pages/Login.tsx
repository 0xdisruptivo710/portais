import { useState, type FormEvent } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  aoEntrar: () => void;
}

/**
 * Porta de entrada do painel. A senha é única por instalação (o painel é
 * interno, não tem usuários): o servidor devolve um cookie de sessão
 * HttpOnly, então esta tela não guarda nada — nem senha, nem token.
 *
 * É a única tela que pode ser autônoma e centralizada: ela aparece antes de
 * o embed no AIOS fazer sentido. Os tokens, porém, são os mesmos.
 */
export default function Login({ aoEntrar }: Props) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function entrar(evento: FormEvent) {
    evento.preventDefault();
    setEntrando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senha }),
      });
      if (resposta.status === 204) {
        aoEntrar();
        return;
      }
      setErro(resposta.status === 401 ? "Senha incorreta." : "Não foi possível entrar agora.");
    } catch {
      setErro("Não foi possível entrar agora.");
    } finally {
      setEntrando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-aios-fundo px-4 py-10">
      <section className="w-full max-w-[360px]">
        <div className="cartao flex flex-col gap-4 p-6">
          <div className="tela-topo">
            <h1 className="text-[18px]">Painel de Portais</h1>
            <p className="tela-descricao">
              Leads dos portais automotivos, prontos para o primeiro contato.
            </p>
          </div>

          <form onSubmit={entrar} className="flex flex-col gap-4">
            <div className="campo">
              <label className="rotulo" htmlFor="login-senha">
                Senha
              </label>
              <input
                id="login-senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="botao botao-primario botao-grande"
              disabled={entrando || senha.length === 0}
            >
              {entrando ? "Entrando..." : "Entrar"}
            </button>
          </form>

          {erro && (
            <p role="alert" className="faixa-erro">
              <AlertCircle aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
              {erro}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
