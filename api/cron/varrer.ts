import { simpleParser } from "mailparser";
import { erro, json } from "../_lib/http.js";
import { getSupabase } from "../_lib/supabase.js";
import { abrirCaixa, caixaDeTodosOsEmails } from "../_lib/imap.js";
import { paraEmailCru } from "../_lib/email.js";
import { ingerir } from "../_lib/ingestao.js";
import { processarEvento } from "../_lib/processar.js";

// Única conta ativa por enquanto (mesmo hardcode de CLIENTE_SLUG em
// config.ts/processar.ts, e o mesmo default de PORTAIS_CONTA_ID em
// scripts/varrer.ts). Quando existir mais de uma, o id vem de config, não daqui.
const CONTA_ID = 1;

// A function tem 300s de teto. IMAP + parser/IA + gravação de cada lead não
// cabem, num lote maior, dentro desse tempo. O cron roda a cada 5min — o
// excedente sobra pra próxima chamada sem se perder, porque ultimo_uid só
// avança até onde esta execução realmente leu.
const TETO_MENSAGENS = 200;

type ClienteSupabase = ReturnType<typeof getSupabase>;

/**
 * GET /api/cron/varrer: varredura incremental da caixa via IMAP. Lê só o que
 * tem UID maior que `portais_contas.ultimo_uid`, grava cada e-mail de portal
 * em portais_eventos_raw (`ingerir`) e interpreta os que são novos
 * (`processarEvento`).
 *
 * Primeiro call site de produção destas duas funções — até aqui só rodavam
 * por teste. Por isso cada mensagem e cada evento são tratados isoladamente
 * (try/catch por item, dentro do loop): uma mensagem malformada ou um lead
 * que estoura no parser/IA não pode impedir os demais e-mails da mesma leva
 * de serem tentados. Falha de autenticação IMAP é a única que aborta a
 * execução inteira — não há como varrer nada sem conexão — e por isso grava
 * `ultimo_erro` na conta e responde 500 em vez de um 200 vazio.
 */
export default async function handler(_request: Request): Promise<Response> {
  const sb = getSupabase();

  const { data: conta, error: erroConta } = await sb
    .from("portais_contas")
    .select("*")
    .eq("id", CONTA_ID)
    .single();
  if (erroConta || !conta) return erro(erroConta?.message ?? "conta nao encontrada", 500);

  const usuario = process.env.GMAIL_IMAP_USER;
  const senha = process.env.GMAIL_IMAP_APP_PASSWORD;
  if (!usuario || !senha) {
    return await falharVarredura(sb, "GMAIL_IMAP_USER e GMAIL_IMAP_APP_PASSWORD sao obrigatorias");
  }

  let client;
  try {
    client = await abrirCaixa({ usuario, senha });
  } catch (e) {
    // Falha de autenticação (App Password revogado, senha da conta trocada)
    // é o risco operacional documentado no design: precisa ficar visível na
    // conta, nunca só num log que ninguém olha.
    return await falharVarredura(sb, mensagemDeErro(e));
  }

  const resumo = { lidos: 0, gravado: 0, duplicado: 0, ignorado: 0, semFonte: 0, processado: 0, falha: 0 };
  let maiorUid = Number(conta.ultimo_uid ?? 0);

  try {
    const caixa = await caixaDeTodosOsEmails(client);
    const lock = await client.getMailboxLock(caixa);
    const messageIdsGravados: string[] = [];

    try {
      const desdeUid = maiorUid + 1;
      for await (const msg of client.fetch({ uid: `${desdeUid}:*` }, { uid: true, source: true })) {
        if (resumo.lidos >= TETO_MENSAGENS) break;
        resumo.lidos++;
        if (msg.uid > maiorUid) maiorUid = msg.uid;

        // O tipo do imapflow marca `source` como opcional mesmo quando
        // pedimos source:true na query (mesma nota de scripts/varrer.ts).
        if (!msg.source) {
          resumo.semFonte++;
          console.warn(`uid ${msg.uid}: sem source, mensagem pulada`);
          continue;
        }

        try {
          const email = paraEmailCru(await simpleParser(msg.source));
          const resultado = await ingerir(email, CONTA_ID);
          if (resultado === "gravado") {
            resumo.gravado++;
            messageIdsGravados.push(email.messageId);
          } else if (resultado === "duplicado") {
            resumo.duplicado++;
          } else {
            resumo.ignorado++;
          }
        } catch (e) {
          // Uma mensagem malformada (parse quebrado, upsert falhando) não
          // pode travar a leitura das seguintes. maiorUid já avançou (linha
          // acima) — insistir nesta mensagem pra sempre, sem conseguir,
          // seria pior do que perdê-la uma vez; fica registrada aqui.
          resumo.falha++;
          console.error(`uid ${msg.uid}: falhou ao ingerir`, e);
        }
      }
    } finally {
      lock.release();
    }

    // Um lookup em lote pelos message_id recém-gravados, em vez de um
    // select por mensagem: até 200 mensagens por execução, uma consulta só.
    if (messageIdsGravados.length > 0) {
      const { data: eventosNovos, error: erroEventosNovos } = await sb
        .from("portais_eventos_raw")
        .select("id")
        .eq("conta_id", CONTA_ID)
        .in("message_id", messageIdsGravados);
      if (erroEventosNovos) throw new Error(erroEventosNovos.message);

      for (const evento of eventosNovos ?? []) {
        try {
          await processarEvento(evento.id);
          resumo.processado++;
        } catch (e) {
          // Mesma disciplina do ingest: um lead que estoura no parser/IA
          // não pode impedir os outros da mesma leva de serem processados.
          // ativarLead (chamado por outra rota) tem a mesma cicatriz — não é
          // chamado daqui, envio real é decisão da operação, fora deste cron.
          resumo.falha++;
          console.error(`evento ${evento.id}: falhou ao processar`, e);
        }
      }
    }
  } catch (e) {
    return await falharVarredura(sb, mensagemDeErro(e));
  } finally {
    // Best effort: a varredura já terminou (com sucesso ou erro já tratado
    // acima); uma falha ao encerrar a sessão IMAP não deve mascarar o
    // resultado nem estourar por conta própria.
    await client.logout().catch(() => {});
  }

  await atualizarConta(sb, { ultimo_uid: maiorUid, ultimo_erro: null });

  return json({ conta_id: CONTA_ID, ultimo_uid: maiorUid, ...resumo });
}

function mensagemDeErro(e: unknown): string {
  return e instanceof Error ? e.message : "falha na varredura";
}

/**
 * Grava ultimo_erro na conta e responde 500. Sempre 500 (mesmo que o próprio
 * update falhe): o objetivo aqui é garantir a resposta de erro pro chamador,
 * não abrir uma segunda guarda dentro de uma guarda de erro. Por isso não
 * confere a linha de volta como atualizarConta faz no caminho de sucesso.
 */
async function falharVarredura(sb: ClienteSupabase, mensagem: string): Promise<Response> {
  await sb.from("portais_contas").update({ ultimo_erro: mensagem }).eq("id", CONTA_ID).select("id");
  return erro(mensagem, 500);
}

/**
 * Mesma cicatriz de sempre nesta casa (ver atualizarLinha em ativacao.ts):
 * PostgREST devolve 200 com lista vazia quando o "id" não existe. Conferir a
 * linha de volta é a única forma de saber que o cursor (`ultimo_uid`) gravou
 * de verdade — sem isso, a próxima execução reler a mesma leva em silêncio.
 */
async function atualizarConta(sb: ClienteSupabase, payload: Record<string, unknown>): Promise<void> {
  const { data, error } = await sb.from("portais_contas").update(payload).eq("id", CONTA_ID).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(`portais_contas ${CONTA_ID} nao atualizada`);
}
