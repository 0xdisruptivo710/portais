import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import Config from "./pages/Config";
import Leads from "./pages/Leads";
import Numeros from "./pages/Numeros";
import Revisao from "./pages/Revisao";

export default function App() {
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
