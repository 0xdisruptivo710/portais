import type { EmailCru, LeadBruto } from "../../src/tipos.js";
import { htmlParaTexto } from "./email.js";
import { leadVazio } from "./parsers/registro.js";

const MODELO = "gpt-4o-mini";
/** Estimativa conservadora por chamada, usada para decidir se cabe no teto. */
const CUSTO_ESTIMADO_USD = 0.004;

export interface Orcamento {
  gastoHojeUsd: number;
  tetoDiaUsd: number;
  tetoEventoUsd: number;
}

/**
 * Teto zerado significa desligado, nunca ilimitado. Um portal que muda de
 * layout faz todo e-mail cair no fallback; sem essa guarda vira conta aberta.
 */
export function podeGastar(o: Orcamento): boolean {
  if (o.tetoDiaUsd <= 0 || o.tetoEventoUsd <= 0) return false;
  return o.gastoHojeUsd + o.tetoEventoUsd <= o.tetoDiaUsd;
}

export function montarPrompt(email: EmailCru): string {
  // Guarda contra `html` ausente: em produção paraEmailCru sempre preenche a
  // string, mas o fallback de IA também precisa tolerar um objeto parcial.
  const corpo = `${email.texto}\n${htmlParaTexto(email.html ?? "")}`.slice(0, 6000);
  return [
    "Extraia os dados do lead deste e-mail de portal automotivo.",
    "Responda SOMENTE com json, sem texto em volta, neste formato:",
    '{"nome":null,"telefone":null,"email":null,"veiculoTexto":null,"anuncioUrl":null,"anuncioIdExterno":null,"mensagemLead":null}',
    "Campo ausente vai como null. Nunca invente valor.",
    "",
    `Assunto: ${email.assunto}`,
    corpo,
  ].join("\n");
}

export async function extrairComIa(
  email: EmailCru,
  orcamento: Orcamento,
): Promise<{ lead: LeadBruto | null; custoUsd: number }> {
  if (!podeGastar(orcamento)) return { lead: null, custoUsd: 0 };

  const chave = process.env.OPENAI_API_KEY;
  if (!chave) return { lead: null, custoUsd: 0 };

  const imagens = email.anexos
    .filter((a) => a.tipo.startsWith("image/"))
    .slice(0, 3)
    .map((a) => ({
      type: "image_url" as const,
      image_url: { url: `data:${a.tipo};base64,${a.conteudoBase64}` },
    }));

  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: montarPrompt(email) }, ...imagens],
          },
        ],
      }),
    });
  } catch {
    // Falha de rede (timeout, DNS, conexão resetada): a chamada não
    // completou, então nada foi cobrado. Sem isso, uma oscilação de rede
    // num e-mail rejeita a Promise e aborta o lote inteiro no cron.
    return { lead: null, custoUsd: 0 };
  }

  if (!resp.ok) return { lead: null, custoUsd: 0 };

  let dados: unknown;
  try {
    dados = await resp.json();
  } catch {
    // resp.ok mas o corpo não é JSON válido: a chamada foi cobrada, mesmo
    // sem dado utilizável. Custo diferente da falha de rede acima.
    return { lead: null, custoUsd: CUSTO_ESTIMADO_USD };
  }

  const bruto = (dados as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  if (!bruto) return { lead: null, custoUsd: CUSTO_ESTIMADO_USD };

  try {
    const parsed = JSON.parse(bruto);
    const lead = { ...leadVazio(), ...parsed } as LeadBruto;
    if (!lead.nome && !lead.telefone) return { lead: null, custoUsd: CUSTO_ESTIMADO_USD };
    return { lead, custoUsd: CUSTO_ESTIMADO_USD };
  } catch {
    return { lead: null, custoUsd: CUSTO_ESTIMADO_USD };
  }
}
