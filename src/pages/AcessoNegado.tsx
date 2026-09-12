import { ShieldAlert } from "lucide-react";

/**
 * O que aparece quando não há chave de embed válida na URL nem sessão de pé.
 *
 * Não pede nada e não conta nada. A mesma tela serve para chave ausente,
 * chave errada e sessão que não pôde ser refeita: distinguir os três casos
 * só ajudaria quem está tentando adivinhar a chave, e o usuário final não
 * tem o que fazer com a diferença. Também não há formulário: o acesso é
 * controlado pelo CRM que embeda o painel, e não existe senha para digitar.
 */
export default function AcessoNegado() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-aios-fundo px-4 py-10">
      <section className="w-full max-w-[360px]">
        <div className="cartao flex flex-col gap-3 p-6">
          <p className="faixa-atencao">
            <ShieldAlert aria-hidden="true" className="mt-px h-4 w-4 shrink-0" />
            Acesso não autorizado
          </p>
          <p className="tela-descricao">
            Abra o painel pela plataforma. Se o acesso continuar negado, fale com quem administra a
            conta.
          </p>
        </div>
      </section>
    </div>
  );
}
