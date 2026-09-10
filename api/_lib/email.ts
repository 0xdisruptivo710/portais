import type { ParsedMail } from "mailparser";
import type { EmailCru } from "../../src/tipos.js";

export function paraEmailCru(parsed: ParsedMail): EmailCru {
  return {
    messageId: parsed.messageId ?? "",
    remetente: parsed.from?.text ?? "",
    assunto: parsed.subject ?? "",
    recebidoEm: (parsed.date ?? new Date()).toISOString(),
    texto: parsed.text ?? "",
    html: typeof parsed.html === "string" ? parsed.html : "",
    anexos: (parsed.attachments ?? []).map((a) => ({
      nome: a.filename ?? "sem-nome",
      tipo: a.contentType ?? "application/octet-stream",
      conteudoBase64: a.content.toString("base64"),
    })),
  };
}

/** Tira as tags e devolve texto legível, para parser e para o fallback de IA. */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    // Fecho de bloco = quebra de parágrafo (linha em branco), não só uma linha.
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n\n")
    // Tag de abertura remanescente some sem deixar espaço: quem separa é o fecho acima.
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    // Espaço colado numa quebra de linha não deve sobrar (ex.: tag some antes do \n\n).
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
