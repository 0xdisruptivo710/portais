import { useEffect, useRef, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { abrirSessaoComChave, aoPerderSessao, chamarApi, temSessao } from "./lib/api";
import AcessoNegado from "./pages/AcessoNegado";
import Config from "./pages/Config";
import Leads from "./pages/Leads";
import Numeros from "./pages/Numeros";
import Revisao from "./pages/Revisao";

/**
 * Este painel roda embedado dentro do AIOS, que já tem cabeçalho, logo e
 * barra de navegação próprios. Por isso o app NÃO desenha nenhum dos três:
 * duas barras empilhadas denunciam que o conteúdo veio de fora. A navegação
 * entre as quatro telas é feita por abas em pílula, no padrão da plataforma.
 */
/**
 * Estados da porta de entrada. "verificando" é o instante entre montar e
 * saber se há acesso; não existe estado intermediário visível.
 */
type EstadoAcesso = "verificando" | "liberado" | "negado";

/**
 * A chave do embed vem na URL (`?k=`), posta lá pelo AIOS no src do iframe.
 * É lida UMA vez, na montagem, e guardada: a navegação entre as abas troca a
 * URL por react-router e leva a query string embora, então reler
 * window.location depois acharia a URL sem chave. Guardar aqui é o que faz a
 * renovação continuar funcionando na terceira aba.
 */
function lerChaveDaUrl(): string | null {
  if (typeof window === "undefined") return null;
  const chave = new URLSearchParams(window.location.search).get("k");
  return chave && chave.length > 0 ? chave : null;
}

export default function App() {
  const [chave] = useState(lerChaveDaUrl);
  const [acesso, setAcesso] = useState<EstadoAcesso>("verificando");
  // Trocar a geração remonta o painel inteiro: depois de renovar a sessão,
  // as telas precisam refazer as chamadas que tinham voltado 401. Sem isso o
  // painel ficaria de pé mostrando o que não conseguiu carregar.
  const [geracao, setGeracao] = useState(0);
  const renovacao = useRef({ emCurso: false, gasta: false });

  // Com chave na URL, a troca por sessão é a primeira chamada de todas, antes
  // de qualquer tela pedir dado. Sem chave, vale a sessão que já exista: é o
  // caso de quem abriu o painel direto, fora do embed, com o cookie ainda
  // válido. Chave errada não cai de volta na sessão existente: é recusa.
  useEffect(() => {
    let ativo = true;
    const promessa = chave ? abrirSessaoComChave(chave) : temSessao();
    promessa.then((liberado) => {
      if (ativo) setAcesso(liberado ? "liberado" : "negado");
    });
    return () => {
      ativo = false;
    };
  }, [chave]);

  // Qualquer 401 de qualquer endpoint derruba a sessão aqui (ver chamarApi
  // em lib/api.ts). Antes de desistir, se a chave do embed estiver na URL,
  // vale UMA troca: é o que faz a expiração de 12h se resolver sozinha
  // dentro do iframe, sem o operador perceber.
  //
  // Duas travas contra laço: `emCurso` junta a enxurrada de 401 que chega ao
  // mesmo tempo (a aba de contagem e a tela aberta falham juntas) numa troca
  // só, e `gasta` garante que a tentativa é uma por carga da página. Se a
  // troca falhar, ou se a sessão cair de novo depois dela, é acesso negado —
  // e recarregar o iframe refaz tudo, porque a chave continua no src.
  useEffect(() => {
    if (acesso !== "liberado") return;
    return aoPerderSessao(() => {
      if (renovacao.current.emCurso) return;
      if (!chave || renovacao.current.gasta) {
        setAcesso("negado");
        return;
      }

      renovacao.current.emCurso = true;
      abrirSessaoComChave(chave).then((renovou) => {
        renovacao.current = { emCurso: false, gasta: true };
        if (renovou) setGeracao((anterior) => anterior + 1);
        else setAcesso("negado");
      });
    });
  }, [acesso, chave]);

  if (acesso === "verificando") {
    return (
      <div className="conteudo">
        <p className="carregando">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
          Carregando...
        </p>
      </div>
    );
  }

  if (acesso === "negado") return <AcessoNegado />;

  return (
    <BrowserRouter key={geracao}>
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
    chamarApi("/api/revisao")
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
