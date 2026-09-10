export interface ItemEstoque {
  id: number;
  marca: string | null;
  modelo: string | null;
  ano: string | null;
  link: string | null;
}

/**
 * Casa o veículo do anúncio com o estoque. O link é a única prova forte, então
 * vem primeiro. Não achar é resultado legítimo: anúncio de carro já vendido
 * costuma continuar no ar, e o lead vale mesmo assim.
 */
export function casarComEstoque(
  veiculoTexto: string | null,
  anuncioUrl: string | null,
  estoque: ItemEstoque[],
): number | null {
  if (anuncioUrl) {
    const porLink = estoque.find((i) => i.link && i.link === anuncioUrl);
    if (porLink) return porLink.id;
  }

  if (!veiculoTexto) return null;
  const alvo = normalizar(veiculoTexto);
  const ano = veiculoTexto.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;

  const candidatos = estoque.filter((i) => {
    const marca = normalizar(i.marca ?? "");
    const modelo = normalizar(i.modelo ?? "");
    return marca !== "" && modelo !== "" && alvo.includes(marca) && alvo.includes(modelo);
  });

  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0].id;

  const porAno = ano ? candidatos.find((i) => i.ano === ano) : undefined;
  return (porAno ?? candidatos[0]).id;
}

/**
 * Tira acento, hifen e espaco, para "T-Cross", "t cross" e "TCROSS" casarem.
 * Faixa de diacriticos combinantes escrita como \u0300-\u036f (forma escapada),
 * em vez do caractere literal na classe: sobrevive melhor a copia entre
 * arquivos e a diferencas de encoding.
 */
function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
