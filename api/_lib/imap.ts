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
