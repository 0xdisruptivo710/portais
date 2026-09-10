import { useState, type FormEvent } from "react";

interface Props {
  aoEntrar: () => void;
}

/**
 * Porta de entrada do painel. A senha é única por instalação (o painel é
 * interno, não tem usuários): o servidor devolve um cookie de sessão
 * HttpOnly, então esta tela não guarda nada — nem senha, nem token.
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
    <section className="login">
      <h1>Painel de Portais</h1>
      <form onSubmit={entrar}>
        <label>
          Senha
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
        </label>
        <button type="submit" disabled={entrando || senha.length === 0}>
          {entrando ? "Entrando..." : "Entrar"}
        </button>
      </form>
      {erro && <p role="alert">{erro}</p>}
    </section>
  );
}
