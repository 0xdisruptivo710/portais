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
  // O CARRO SP manda do domínio curto e anuncia no longo: o e-mail de lead
  // chega de noreply@carsp.com.br e aponta para carrosp.com.br.
  carrosp: ["carsp.com.br", "carrosp.com.br"],
  usadosbr: ["usadosbr.com"],
  // Domínio de marketing da OLX, separado de olx.com.br. Era a regra de
  // domínio completo acima que o deixava de fora, e ela continua certa: o que
  // faltava não era afrouxar o casamento, era catalogar o domínio.
  olxchat: ["newsolx.com.br"],
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
