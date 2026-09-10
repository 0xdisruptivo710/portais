import type { EmailCru } from "../../src/tipos.js";
import { identificarPortal } from "./portal.js";
import { getSupabase } from "./supabase.js";

export type ResultadoIngestao = "gravado" | "duplicado" | "ignorado";

/**
 * Grava o e-mail cru se ele for de portal. Nada é interpretado aqui: o objetivo
 * é que nenhum lead se perca por bug de parser. Sem messageId não dá para
 * deduplicar, então preferimos descartar a criar linha que duplica a cada leitura.
 */
export async function ingerir(email: EmailCru, contaId: number): Promise<ResultadoIngestao> {
  if (!email.messageId) return "ignorado";

  const portal = identificarPortal(email.remetente);
  if (!portal) return "ignorado";

  const { data, error } = await getSupabase()
    .from("portais_eventos_raw")
    .upsert(
      {
        conta_id: contaId,
        portal,
        origem: "email",
        message_id: email.messageId,
        assunto: email.assunto,
        remetente: email.remetente,
        recebido_em: email.recebidoEm,
        corpo_texto: email.texto,
        corpo_html: email.html,
        anexos: email.anexos,
        status: "novo",
      },
      { onConflict: "conta_id,message_id", ignoreDuplicates: true },
    )
    .select("id");

  if (error) throw new Error(error.message);
  return data && data.length > 0 ? "gravado" : "duplicado";
}
