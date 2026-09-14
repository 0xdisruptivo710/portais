import { ImapFlow } from "imapflow";

export interface CredenciaisImap {
  usuario: string;
  senha: string;
}

export async function abrirCaixa(cred: CredenciaisImap): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: cred.usuario, pass: cred.senha },
    logger: false,
  });
  await client.connect();
  return client;
}

/**
 * A pasta "Todos os e-mails" do Gmail muda de nome conforme o idioma da conta:
 * "[Gmail]/All Mail", "[Gmail]/Todos os e-mails". Procurar pelo nome quebra em
 * conta configurada em outro idioma. O atributo especial \All não muda.
 * Se não achar, cai para INBOX, que ao menos existe sempre.
 */
export async function caixaDeTodosOsEmails(client: ImapFlow): Promise<string> {
  for (const caixa of await client.list()) {
    if (caixa.specialUse === "\\All") return caixa.path;
  }
  return "INBOX";
}

/**
 * A Lixeira do Gmail também muda de nome com o idioma da conta ("[Gmail]/
 * Lixeira", "[Gmail]/Trash") — mesmo motivo de caixaDeTodosOsEmails, e mesmo
 * jeito de resolver: pelo atributo especial \Trash, nunca pelo nome.
 *
 * Diferente de \All, aqui não existe fallback: nem toda conta tem Lixeira (ou
 * pode ter sido esvaziada/desativada), e cair em outra pasta "pra não
 * quebrar" leria e-mails errados. Devolve null e quem chama segue só com a
 * \All.
 */
export async function caixaDaLixeira(client: ImapFlow): Promise<string | null> {
  for (const caixa of await client.list()) {
    if (caixa.specialUse === "\\Trash") return caixa.path;
  }
  return null;
}

export interface PastaParaLer {
  pasta: string;
  /** true quando é a Lixeira — quem chama usa isso pra saber qual cursor (ultimo_uid x ultimo_uid_lixeira) pertence a esta pasta. */
  lixeira: boolean;
}

/**
 * As pastas que uma varredura precisa cobrir: \All sempre, e \Trash quando
 * a conta tiver. Centralizado aqui porque o cron (api/cron/varrer.ts) e o
 * script de backfill (scripts/varrer.ts) têm que decidir isso do mesmo jeito
 * — o vazamento que motivou esta função foi um dos dois ler só a \All.
 */
export async function pastasParaLer(client: ImapFlow): Promise<PastaParaLer[]> {
  const pastas: PastaParaLer[] = [{ pasta: await caixaDeTodosOsEmails(client), lixeira: false }];
  const lixeira = await caixaDaLixeira(client);
  if (lixeira) pastas.push({ pasta: lixeira, lixeira: true });
  return pastas;
}
