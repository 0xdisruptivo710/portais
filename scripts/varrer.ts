import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simpleParser } from "mailparser";
import { abrirCaixa, pastasParaLer } from "../api/_lib/imap.js";
import { paraEmailCru } from "../api/_lib/email.js";
import { identificarPortal } from "../api/_lib/portal.js";
import { ingerir } from "../api/_lib/ingestao.js";
import { interpretarPendentes } from "../api/_lib/fila.js";
import type { Portal } from "../src/tipos.js";

// O script não tem o teto de 300s da function: o backfill de 90 dias precisa
// interpretar tudo o que ingeriu numa passada só, senão o acervo de fixtures
// vem sem os leads correspondentes.
const TETO_INTERPRETACAO = 10_000;

const dias = Number(process.argv.find((a) => a.startsWith("--dias="))?.split("=")[1] ?? 90);
const salvarFixtures = process.argv.includes("--fixtures");
// Backfill longo: ingerir sem interpretar. Sem parser deterministico, cada
// e-mail cai no fallback de IA e o teto diario corta no meio, jogando o resto
// na fila de revisao sem necessidade. Ingere agora, interpreta depois que os
// parsers existirem — de graca e com confianca alta.
const soIngerir = process.argv.includes("--so-ingerir");
const contaId = Number(process.env.PORTAIS_CONTA_ID ?? 1);

const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
const contagem: Partial<Record<Portal, number>> = {};
const resumo = { gravado: 0, duplicado: 0, ignorado: 0, lidos: 0, semFonte: 0, falha: 0 };

const usuario = process.env.GMAIL_IMAP_USER;
const senha = process.env.GMAIL_IMAP_APP_PASSWORD;
if (!usuario || !senha) {
  throw new Error("GMAIL_IMAP_USER e GMAIL_IMAP_APP_PASSWORD sao obrigatorias");
}

const client = await abrirCaixa({ usuario, senha });

// A Lixeira entra na mesma varredura de backfill que a \All: e' de la' que
// vem o lead que a equipe apaga depois de atender (ver imap.ts). Sem
// pastasParaLer aqui, o script de reprocessamento ficaria capturando um
// acervo de fixtures e um resumo que nunca incluem a pasta que mais perde
// lead.
const pastas = await pastasParaLer(client);
console.log(
  `lendo ${pastas.map((p) => p.pasta).join(", ")} desde ${desde.toISOString().slice(0, 10)}`,
);

try {
  for (const p of pastas) {
    const lock = await client.getMailboxLock(p.pasta);
    try {
      for await (const msg of client.fetch({ since: desde }, { uid: true, source: true })) {
        resumo.lidos++;

        // O tipo do imapflow marca `source` como opcional mesmo quando pedimos
        // source:true na query; sem essa guarda o simpleParser recebe undefined.
        // Perder um e-mail aqui tem que deixar rastro: sem o contador e o warn,
        // o lead some da varredura sem nenhuma linha no resumo final.
        if (!msg.source) {
          resumo.semFonte++;
          console.warn(`uid ${msg.uid} (${p.pasta}): sem source, mensagem pulada`);
          continue;
        }

        try {
          const email = paraEmailCru(await simpleParser(msg.source));
          const portal = identificarPortal(email.remetente);

          // A dedupe por (conta_id, message_id) dentro de `ingerir` e' o que
          // torna seguro ler as duas pastas: um e-mail capturado na \All e
          // depois apagado reaparece aqui, mas `ingerir` devolve "duplicado"
          // em vez de gravar o lead de novo.
          const r = await ingerir(email, contaId);
          resumo[r]++;

          if (portal) {
            contagem[portal] = (contagem[portal] ?? 0) + 1;
            if (salvarFixtures && (contagem[portal] ?? 0) <= 10) {
              const dir = join("api/_lib/parsers/fixtures", portal);
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, `${String(contagem[portal]).padStart(2, "0")}.eml`), msg.source);
            }
          }
        } catch (e) {
          // Mesma disciplina do cron: uma mensagem que estoura no simpleParser
          // nao pode abortar a varredura. Esta roda uma vez so, sobre 90 dias de
          // caixa real, e e' ela que produz o acervo de fixtures -- perder tudo
          // por causa de um e-mail malformado sairia caro.
          resumo.falha++;
          console.error(`uid ${msg.uid} (${p.pasta}): falhou ao ingerir`, e);
        }

        if (resumo.lidos % 200 === 0) console.log(`  ...${resumo.lidos} lidos`);
      }
    } finally {
      lock.release();
    }
  }
} finally {
  await client.logout();
}

console.log(
  "\nlidos:", resumo.lidos,
  "| gravados:", resumo.gravado,
  "| duplicados:", resumo.duplicado,
  "| sem fonte:", resumo.semFonte,
  "| falharam:", resumo.falha,
);
console.log("por portal:", contagem);

// Ingerir só grava o e-mail cru. Sem este passo, o backfill de 90 dias
// terminaria com portais_eventos_raw cheia e portais_leads vazia — e é a
// contagem por portal em cima dos leads que a cliente vai conferir.
if (soIngerir) {
  console.log("--so-ingerir: eventos gravados crus, nada interpretado.");
} else {
  const fila = await interpretarPendentes({ teto: TETO_INTERPRETACAO });
  console.log("interpretados:", fila.processado, "| falharam:", fila.falha);
}
