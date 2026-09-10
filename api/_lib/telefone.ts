/** DDDs válidos no Brasil. Fora desta lista, o número não é confiável. */
const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35,
  37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64,
  65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88,
  89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Normaliza para E.164 sem o "+": 5515991280217.
 *
 * Nunca acrescenta nem remove o nono dígito. Um número de 12 dígitos com 55 na
 * frente é devolvido como veio, mesmo podendo ser um celular antigo sem o 9:
 * adivinhar aqui corrompe a base inteira e o erro só aparece no dia do disparo.
 */
export function paraE164(bruto: string | null): string | null {
  if (!bruto) return null;

  let digitos = bruto.replace(/[^0-9]/g, "");
  if (!digitos) return null;

  // Zero de operadora na frente (0 15 99128...). No máximo um: DDD nunca
  // começa com zero, então sobrar outro depois deste corte é lixo (ou dois
  // trontos emendados), não uma segunda operadora — nunca usar `while` aqui.
  //
  // Resíduo conhecido e deliberadamente não resolvido: um número de 11
  // dígitos com exatamente um zero na frente é ambíguo por natureza. Ex.:
  // "01532451234" (tronco 0 + DDD 15 real + fixo "32451234") e
  // "01991280217" (DDD fictício "01" que, ao perder o zero, se funde com o 9
  // do celular e "vira" DDD "19" + "91280217") têm exatamente a mesma forma
  // depois do corte — não existe informação no dado para separar os dois.
  // Inventar uma regra pra escolher um dos dois seria chute; a rede de
  // segurança pra esse caso é a fila de revisão humana mais adiante no
  // sistema, não esta função.
  if (digitos.startsWith("0")) digitos = digitos.slice(1);
  if (digitos.startsWith("0")) return null;

  // Já vem com o código do país
  if (digitos.length === 12 || digitos.length === 13) {
    if (!digitos.startsWith("55")) return null;
    return dddValido(digitos.slice(2, 4)) ? digitos : null;
  }

  // Sem código do país: 10 dígitos (fixo) ou 11 (celular)
  if (digitos.length === 10 || digitos.length === 11) {
    return dddValido(digitos.slice(0, 2)) ? `55${digitos}` : null;
  }

  return null;
}

function dddValido(ddd: string): boolean {
  return DDDS_VALIDOS.has(Number(ddd));
}

/** Formato de exibição usado na base: +55 (15) 99128-0217 */
export function paraExibicao(e164: string | null): string | null {
  if (!e164) return null;
  const ddd = e164.slice(2, 4);
  const local = e164.slice(4);
  const corte = local.length === 9 ? 5 : 4;
  return `+55 (${ddd}) ${local.slice(0, corte)}-${local.slice(corte)}`;
}

/** O campo `to` do WTS exige +55|<local sem o 55>. Mandar em dígitos não entrega. */
export function paraPipeWts(e164: string): string {
  return `+55|${e164.slice(2)}`;
}
