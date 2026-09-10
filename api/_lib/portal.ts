import type { Portal } from "../../src/tipos.js";

/**
 * Domínios por portal. Casa por domínio completo ou subdomínio, nunca por
 * substring solta: "folxcarros.com.br" não pode virar lead da OLX.
 */
const DOMINIOS: Record<Portal, string[]> = {
  webmotors: ["webmotors.com.br"],
  icarros: ["icarros.com.br"],
  chavesnamao: ["chavesnamao.com.br"],
  comprecar: ["comprecar.com.br"],
  olx: ["olx.com.br", "olxbr.com"],
  mercadolivre: ["mercadolivre.com.br", "mercadolivre.com", "mercadolibre.com"],
};

export function identificarPortal(remetente: string): Portal | null {
  if (!remetente) return null;

  const endereco = extrairEndereco(remetente);
  if (!endereco) return null;

  const dominio = endereco.split("@")[1];
  if (!dominio) return null;

  for (const [portal, dominios] of Object.entries(DOMINIOS)) {
    for (const alvo of dominios) {
      if (dominio === alvo || dominio.endsWith(`.${alvo}`)) {
        return portal as Portal;
      }
    }
  }
  return null;
}

/** Aceita tanto "fulano@x.com" quanto "Nome <fulano@x.com>". */
function extrairEndereco(remetente: string): string | null {
  const comAngulo = remetente.match(/<([^>]+)>/);
  const bruto = (comAngulo ? comAngulo[1] : remetente).trim().toLowerCase();
  return bruto.includes("@") ? bruto : null;
}
