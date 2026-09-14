import type { EmailCru } from "../../../src/tipos.js";
import { htmlParaTexto } from "../email.js";

/**
 * Texto de trabalho do parser. O HTML vem primeiro porque é a única parte que
 * os três portais preenchem de verdade: o Chaves na Mão manda um `text/plain`
 * com 37 caracteres ("© 2023. All rights reserved.") e joga todo o lead no
 * HTML. O `texto` só entra como rede de segurança se o HTML vier vazio.
 */
export function textoDoEmail(email: EmailCru): string {
  return htmlParaTexto(email.html) || email.texto;
}

/**
 * Os dois corpos do e-mail, com o `text/plain` PRIMEIRO. O inverso de
 * `textoDoEmail`, e serve ao portal que faz o inverso dos outros: o CARRO SP
 * manda a ficha inteira rotulada no plain ("MODELO..........: Renegade 1.8")
 * e, no HTML, o mesmo carro dentro de um <h3> sem rótulo nenhum.
 *
 * Os dois entram juntos, e não um ou outro, porque `capturar` devolve a
 * PRIMEIRA ocorrência: a ficha do plain ganha quando existe, e o HTML fica de
 * rede de segurança para o dia em que o portal parar de mandar plain.
 */
export function textoPlainEHtml(email: EmailCru): string {
  return [email.texto, htmlParaTexto(email.html)].filter((parte) => parte.trim() !== "").join("\n\n");
}

/** Primeiro grupo de captura, ou null. Evita repetir `?.[1] ?? null` em todo parser. */
export function capturar(texto: string, re: RegExp): string | null {
  return texto.match(re)?.[1]?.trim() || null;
}

/**
 * Junta o que a diagramação do e-mail quebrou em várias linhas. A Webmotors
 * usa `<br>` no meio da frase do lead em parte dos e-mails e não em outros;
 * sem isso, dois leads com a mesma mensagem sairiam diferentes.
 */
export function umaLinha(valor: string | null): string | null {
  if (valor === null) return null;
  const limpo = valor.replace(/\s+/g, " ").trim();
  return limpo || null;
}

/**
 * Telefone dentro de um trecho maior. O Comprecar escreve
 * `(15) 99128-0217 (Prefere ser contatado via WhatsApp)` na mesma linha, e a
 * máscara muda por portal (a Webmotors manda os nove dígitos sem hífen), então
 * o que se procura é o formato, não a linha inteira.
 */
export function telefoneDoTrecho(trecho: string | null): string | null {
  if (!trecho) return null;
  return trecho.match(/\(?\d{2}\)?\s*\d{4,5}-?\d{4}/)?.[0]?.trim() || null;
}
