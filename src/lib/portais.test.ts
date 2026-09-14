import { describe, expect, it } from "vitest";
import { PORTAIS } from "../tipos";
import { ROTULOS as ROTULOS_CLIENTE } from "./portais";
// Import cruzado de propósito: api/_lib/ativacao.ts duplica este mapa pra
// não arrastar código de servidor pro bundle do cliente (ver comentário em
// portais.ts). Só um teste, que não vai pro bundle, pode importar dos dois
// lados e garantir que a duplicação não diverge.
import { ROTULOS as ROTULOS_SERVIDOR } from "../../api/_lib/ativacao.js";
// Terceira cópia do mesmo mapa: a prévia do lote monta o texto por conta
// própria (api/_lib/lote.ts) e precisa dizer o mesmo nome de portal que a
// mensagem que sai. Era a única das três que nenhum teste olhava.
import { ROTULOS as ROTULOS_LOTE } from "../../api/_lib/lote.js";

describe("rótulos de portal: cliente x servidor não podem divergir", () => {
  it("tem exatamente as mesmas chaves e os mesmos valores nos três mapas", () => {
    expect(ROTULOS_CLIENTE).toEqual(ROTULOS_SERVIDOR);
    expect(ROTULOS_LOTE).toEqual(ROTULOS_SERVIDOR);
  });

  it("cobre todos os portais do catálogo, nos três", () => {
    for (const portal of PORTAIS) {
      expect(ROTULOS_CLIENTE[portal]).toBeTruthy();
      expect(ROTULOS_SERVIDOR[portal]).toBeTruthy();
      expect(ROTULOS_LOTE[portal]).toBeTruthy();
    }
  });
});
