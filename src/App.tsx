import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import Config from "./pages/Config";
import Leads from "./pages/Leads";
import Login from "./pages/Login";
import Numeros from "./pages/Numeros";
import Revisao from "./pages/Revisao";

/**
 * Este painel roda embedado dentro do AIOS, que já tem cabeçalho, logo e
 * barra de navegação próprios. Por isso o app NÃO desenha nenhum dos três:
 * duas barras empilhadas denunciam que o conteúdo veio de fora. A navegação
 * entre as quatro telas é feita por abas em pílula, no padrão da plataforma.
 */
export default function App() {
  const [autenticado, setAutenticado] = useState<boolean | null>(null);

  // A guarda que vale é a do servidor (api/_lib/sessao.ts) — esta é só a
  // porta visível: sem sessão, mostra o login em vez de quatro telas vazias
  // com "nao autorizado". Erro de rede também cai no login, nunca no painel.
  useEffect(() => {
    fetch("/api/config")
      .then((resposta) => setAutenticado(resposta.status !== 401))
      .catch(() => setAutenticado(false));
  }, []);

  if (autenticado === null) {
    return (
      <div className="conteudo">
        <p className="carregando">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando...
        </p>
      </div>
    );
  }

  if (!autenticado) return <Login aoEntrar={() => setAutenticado(true)} />;

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-aios-fundo">
        <div className="conteudo">
          <Abas />
          <main>
            <Routes>
              <Route path="/" element={<Leads />} />
              <Route path="/revisao" element={<Revisao />} />
              <Route path="/numeros" element={<Numeros />} />
              <Route path="/config" element={<Config />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

function classeDaAba({ isActive }: { isActive: boolean }): string {
  return isActive ? "aba aba-ativa" : "aba";
}

/**
 * A fila de revisão é a única aba com contagem: ela acumula o que o parser
 * não conseguiu interpretar, e esse número é o que decide se alguém precisa
 * abrir a tela hoje. Selo numérico vermelho ao lado do rótulo, como o
 * "Novos 37" do AIOS. Se a contagem não puder ser lida, a aba simplesmente
 * não mostra selo nenhum: um número errado seria pior que nenhum.
 */
function Abas() {
  const [pendentes, setPendentes] = useState(0);

  useEffect(() => {
    let ativo = true;
    fetch("/api/revisao")
      .then((resposta) => (resposta.ok ? resposta.json() : null))
      .then((corpo: { itens?: unknown[] } | null) => {
        if (ativo && Array.isArray(corpo?.itens)) setPendentes(corpo.itens.length);
      })
      .catch(() => {});
    return () => {
      ativo = false;
    };
  }, []);

  return (
    <nav className="abas" aria-label="Seções do painel">
      <NavLink to="/" end className={classeDaAba}>
        Leads
      </NavLink>
      <NavLink to="/revisao" className={classeDaAba}>
        Revisão
        {pendentes > 0 && <span className="aba-contagem">{pendentes}</span>}
      </NavLink>
      <NavLink to="/numeros" className={classeDaAba}>
        Números
      </NavLink>
      <NavLink to="/config" className={classeDaAba}>
        Configuração
      </NavLink>
    </nav>
  );
}
