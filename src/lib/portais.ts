import { PORTAIS, type Portal } from "../tipos";

/** Mesmos rótulos de exibição de api/_lib/ativacao.ts, para o painel falar a
 * mesma língua que a mensagem que o lead recebe. */
const ROTULOS: Record<Portal, string> = {
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

export const STATUS_ATIVACAO_OPCOES = [
  { valor: "pendente", rotulo: "Pendente" },
  { valor: "dry_run", rotulo: "Simulado" },
  { valor: "suprimido", rotulo: "Suprimido" },
  { valor: "enviado", rotulo: "Enviado" },
] as const;

export { PORTAIS };
