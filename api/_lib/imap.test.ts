import { describe, expect, it } from "vitest";
import { caixaDaLixeira, caixaDeTodosOsEmails, pastasParaLer } from "./imap";
import type { ImapFlow } from "imapflow";

/** Só o que as três funções usam: client.list(). O resto do ImapFlow real não importa aqui. */
function clienteComPastas(pastas: Array<{ path: string; specialUse?: string }>): ImapFlow {
  return { list: async () => pastas } as unknown as ImapFlow;
}

describe("caixaDeTodosOsEmails", () => {
  it("acha a pasta pelo atributo \\All, não pelo nome", async () => {
    const client = clienteComPastas([
      { path: "INBOX" },
      { path: "[Gmail]/Todos os e-mails", specialUse: "\\All" },
      { path: "[Gmail]/Lixeira", specialUse: "\\Trash" },
    ]);
    expect(await caixaDeTodosOsEmails(client)).toBe("[Gmail]/Todos os e-mails");
  });

  it("acha em conta com nomes em inglês, sem depender do idioma", async () => {
    const client = clienteComPastas([
      { path: "INBOX" },
      { path: "[Gmail]/All Mail", specialUse: "\\All" },
      { path: "[Gmail]/Trash", specialUse: "\\Trash" },
    ]);
    expect(await caixaDeTodosOsEmails(client)).toBe("[Gmail]/All Mail");
  });

  it("cai para INBOX quando a conta não tem pasta \\All", async () => {
    const client = clienteComPastas([{ path: "INBOX" }]);
    expect(await caixaDeTodosOsEmails(client)).toBe("INBOX");
  });
});

describe("caixaDaLixeira", () => {
  it("acha a pasta pelo atributo \\Trash, não pelo nome", async () => {
    const client = clienteComPastas([
      { path: "INBOX" },
      { path: "[Gmail]/Todos os e-mails", specialUse: "\\All" },
      { path: "[Gmail]/Lixeira", specialUse: "\\Trash" },
    ]);
    expect(await caixaDaLixeira(client)).toBe("[Gmail]/Lixeira");
  });

  it("acha em conta com nomes em inglês, sem depender do idioma", async () => {
    const client = clienteComPastas([
      { path: "INBOX" },
      { path: "[Gmail]/All Mail", specialUse: "\\All" },
      { path: "[Gmail]/Trash", specialUse: "\\Trash" },
    ]);
    expect(await caixaDaLixeira(client)).toBe("[Gmail]/Trash");
  });

  it("devolve null quando a conta não tem Lixeira, em vez de cair em outra pasta", async () => {
    const client = clienteComPastas([
      { path: "INBOX" },
      { path: "[Gmail]/All Mail", specialUse: "\\All" },
    ]);
    expect(await caixaDaLixeira(client)).toBeNull();
  });
});

describe("pastasParaLer", () => {
  it("inclui a Lixeira quando ela existe, depois da \\All", async () => {
    const client = clienteComPastas([
      { path: "[Gmail]/All Mail", specialUse: "\\All" },
      { path: "[Gmail]/Trash", specialUse: "\\Trash" },
    ]);
    expect(await pastasParaLer(client)).toEqual([
      { pasta: "[Gmail]/All Mail", lixeira: false },
      { pasta: "[Gmail]/Trash", lixeira: true },
    ]);
  });

  it("segue só com a \\All quando a conta não tem Lixeira, em vez de quebrar", async () => {
    const client = clienteComPastas([{ path: "[Gmail]/All Mail", specialUse: "\\All" }]);
    expect(await pastasParaLer(client)).toEqual([{ pasta: "[Gmail]/All Mail", lixeira: false }]);
  });
});
