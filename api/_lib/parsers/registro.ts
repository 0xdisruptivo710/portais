import type { EmailCru, LeadBruto, Portal } from "../../../src/tipos.js";

export type Parser = (email: EmailCru) => LeadBruto | null;

export function leadVazio(): LeadBruto {
  return {
    nome: null,
    telefone: null,
    email: null,
    veiculoTexto: null,
    anuncioUrl: null,
    anuncioIdExterno: null,
    mensagemLead: null,
  };
}

/** Preenchido na Task 7, um portal por vez, a partir de e-mail real. */
const PARSERS: Partial<Record<Portal, Parser>> = {};

export function parserDoPortal(portal: Portal): Parser | null {
  return PARSERS[portal] ?? null;
}

export function registrarParser(portal: Portal, parser: Parser): void {
  PARSERS[portal] = parser;
}
