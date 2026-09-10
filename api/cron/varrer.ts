import { simpleParser } from "mailparser";
import { erro, json } from "../_lib/http.js";
import { exigirCron } from "../_lib/sessao.js";
import { getSupabase } from "../_lib/supabase.js";
import { abrirCaixa, caixaDeTodosOsEmails } from "../_lib/imap.js";
import { paraEmailCru } from "../_lib/email.js";
import { ingerir } from "../_lib/ingestao.js";
import { ativarPendentes, interpretarPendentes } from "../_lib/fila.js";

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
 * GET /api/cron/varrer: varredura incremental da caixa via IMAP, em três
 * passos. Lê só o que tem UID maior que `portais_contas.ultimo_uid` e grava
 * cada e-mail de portal em portais_eventos_raw (`ingerir`); depois interpreta
 * a FILA de eventos crus (`interpretarPendentes`); depois ativa a FILA de
 * leads pendentes (`ativarPendentes`), que em dry_run só grava a auditoria.
 *
 * Os dois últimos passos varrem fila, não a leva que acabou de chegar: um
 * evento gravado por outra execução (ou pelo backfill do script) volta de
 * `ingerir` como "duplicado" e nunca seria interpretado se o cron olhasse só
 * para os message_id desta rodada.
 *
 * Cada mensagem é tratada isoladamente (try/catch por item, dentro do loop):
 * uma mensagem malformada não pode impedir as demais da mesma leva — os
 * drenadores têm a mesma disciplina, item a item, dentro de fila.ts. Falha de
 * autenticação IMAP aborta a execução inteira — não há como varrer nada sem
 * conexão — e por isso grava `ultimo_erro` na conta e responde 500 em vez de
 * um 200 vazio.
 */
export default async function handler(request: Request): Promise<Response> {
  // Quem chama é a Vercel, não um humano: segredo próprio, conferido antes
  // de abrir conexão com banco ou IMAP. Sem isso, a URL do cron dispara a
  // leitura da caixa de e-mail da cliente para qualquer um.
  const barrado = exigirCron(request);
  if (barrado) return barrado;

  const sb = getSupabase();

  // `ativo` é o botão de pausa da conta: sem este filtro, pausar não pausava
  // nada e a caixa continuava sendo lida a cada 5 minutos.
  const { data: conta, error: erroConta } = await sb
    .from("portais_contas")
    .select("*")
    .eq("id", CONTA_ID)
    .eq("ativo", true)
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

  const resumo = { lidos: 0, gravado: 0, duplicado: 0, ignorado: 0, semFonte: 0, falha: 0 };
  let maiorUid = Number(conta.ultimo_uid ?? 0);

  try {
    const caixa = await caixaDeTodosOsEmails(client);
    const lock = await client.getMailboxLock(caixa);

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
  } catch (e) {
    return await falharVarredura(sb, mensagemDeErro(e));
  } finally {
    // Best effort: a varredura já terminou (com sucesso ou erro já tratado
    // acima); uma falha ao encerrar a sessão IMAP não deve mascarar o
    // resultado nem estourar por conta própria.
    await client.logout().catch(() => {});
  }

  // O cursor é gravado ANTES de drenar as filas: a leitura do IMAP já
  // terminou, e uma falha no processamento não pode fazer a próxima execução
  // reler as mesmas mensagens. O que ficou na fila continua lá, esperando.
  await atualizarConta(sb, { ultimo_uid: maiorUid, ultimo_erro: null });

  let interpretados;
  let ativados;
  try {
    interpretados = await interpretarPendentes();
    ativados = await ativarPendentes();
  } catch (e) {
    // Falha aqui é da consulta da fila (banco fora do ar, RLS), não de um
    // item — item que estoura é tratado dentro de fila.ts e vira 'falhou'.
    return await falharVarredura(sb, mensagemDeErro(e));
  }

  return json({
    conta_id: CONTA_ID,
    ultimo_uid: maiorUid,
    ...resumo,
    processado: interpretados.processado,
    ativado: ativados.processado,
    falha: resumo.falha + interpretados.falha + ativados.falha,
  });
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
