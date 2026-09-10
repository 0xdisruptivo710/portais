import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import Config from "./pages/Config";
import Leads from "./pages/Leads";
import Login from "./pages/Login";
import Numeros from "./pages/Numeros";
import Revisao from "./pages/Revisao";

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

  if (autenticado === null) return <p>Carregando...</p>;
  if (!autenticado) return <Login aoEntrar={() => setAutenticado(true)} />;

  return (
    <BrowserRouter>
      <div className="app">
        <header className="app-cabecalho">
          <h1>Painel de Portais</h1>
          <nav>
            <NavLink to="/" end>
              Leads
            </NavLink>
            <NavLink to="/revisao">Revisão</NavLink>
            <NavLink to="/numeros">Números</NavLink>
            <NavLink to="/config">Configuração</NavLink>
          </nav>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Leads />} />
            <Route path="/revisao" element={<Revisao />} />
            <Route path="/numeros" element={<Numeros />} />
            <Route path="/config" element={<Config />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
