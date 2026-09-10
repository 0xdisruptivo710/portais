import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { simpleParser } from "mailparser";
import { abrirCaixa, caixaDeTodosOsEmails } from "../api/_lib/imap.js";
import { paraEmailCru } from "../api/_lib/email.js";
import { identificarPortal } from "../api/_lib/portal.js";
import { ingerir } from "../api/_lib/ingestao.js";
import type { Portal } from "../src/tipos.js";

const dias = Number(process.argv.find((a) => a.startsWith("--dias="))?.split("=")[1] ?? 90);
const salvarFixtures = process.argv.includes("--fixtures");
const contaId = Number(process.env.PORTAIS_CONTA_ID ?? 1);

const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
const contagem: Partial<Record<Portal, number>> = {};
const resumo = { gravado: 0, duplicado: 0, ignorado: 0, lidos: 0 };

const usuario = process.env.GMAIL_IMAP_USER;
const senha = process.env.GMAIL_IMAP_APP_PASSWORD;
if (!usuario || !senha) {
  throw new Error("GMAIL_IMAP_USER e GMAIL_IMAP_APP_PASSWORD sao obrigatorias");
}

const client = await abrirCaixa({ usuario, senha });

const caixa = await caixaDeTodosOsEmails(client);
console.log(`lendo ${caixa} desde ${desde.toISOString().slice(0, 10)}`);

const lock = await client.getMailboxLock(caixa);
try {
  for await (const msg of client.fetch({ since: desde }, { uid: true, source: true })) {
    resumo.lidos++;

    // O tipo do imapflow marca `source` como opcional mesmo quando pedimos
    // source:true na query; sem essa guarda o simpleParser recebe undefined.
    if (!msg.source) continue;

    const email = paraEmailCru(await simpleParser(msg.source));
    const portal = identificarPortal(email.remetente);

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

    if (resumo.lidos % 200 === 0) console.log(`  ...${resumo.lidos} lidos`);
  }
} finally {
  lock.release();
  await client.logout();
}

console.log("\nlidos:", resumo.lidos, "| gravados:", resumo.gravado, "| duplicados:", resumo.duplicado);
console.log("por portal:", contagem);
