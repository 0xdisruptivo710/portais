import { PORTAIS, type Portal } from "../tipos";

/**
 * Mesmos rótulos de exibição de api/_lib/ativacao.ts, para o painel falar a
 * mesma língua que a mensagem que o lead recebe. Duplicado de propósito (não
 * arrastar código de servidor pro bundle do cliente) — src/lib/portais.test.ts
 * compara os dois mapas e falha se um portal for adicionado só de um lado.
 * Exportado só para esse teste; código de produção usa rotuloPortal().
 */
export const ROTULOS: Record<Portal, string> = {
  webmotors: "Webmotors",
  icarros: "iCarros",
  chavesnamao: "Chaves na Mão",
  comprecar: "Comprecar",
  olx: "OLX",
  mercadolivre: "Mercado Livre",
};

export function rotuloPortal(portal: string): string {
  return (ROTULOS as Record<string, string>)[portal] ?? portal;
}

/**
 * Status da linha que não veio de `portais_leads`: é o evento cru que nem o
 * parser nem a IA conseguiram ler e que espera na fila de revisão
 * (portais_eventos_raw.status = 'revisao'). Ele aparece na mesma lista de
 * Leads desde que a aba própria saiu da navegação — a aba podia sair, a fila
 * não: é ela que sustenta "perder lead é impossível por construção".
 */
export const STATUS_REVISAO = "revisao";

export const STATUS_ATIVACAO_OPCOES = [
  { valor: "pendente", rotulo: "Pendente" },
  { valor: "dry_run", rotulo: "Simulado" },
  { valor: "suprimido", rotulo: "Suprimido" },
  { valor: "enviado", rotulo: "Enviado" },
  // Estado que o drenador de fila (api/_lib/fila.ts) grava quando a ativação
  // de um lead estoura. Sem a opção aqui, esses leads sumiriam do filtro.
  { valor: "falhou", rotulo: "Falhou" },
  { valor: STATUS_REVISAO, rotulo: "Precisa revisão" },
] as const;

/**
 * Rótulo de exibição do status de ativação, o mesmo do filtro. A lista
 * mostra o rótulo, não o valor cru gravado no banco: "dry_run" é vocabulário
 * de contrato de API, não de quem opera a tela.
 */
export function rotuloStatus(status: string | null | undefined): string {
  if (!status) return "Pendente";
  const opcao = STATUS_ATIVACAO_OPCOES.find((o) => o.valor === status);
  return opcao ? opcao.rotulo : status;
}

export { PORTAIS };
