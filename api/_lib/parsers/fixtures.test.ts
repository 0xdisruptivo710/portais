import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { paraEmailCru } from "../email.js";
import { parserDoPortal } from "./index.js";
import { PORTAIS_COM_DADOS, type Portal } from "../../../src/tipos.js";

// `new URL("./fixtures", import.meta.url)` quebra aqui: o ambiente de teste é
// jsdom (environment: "jsdom" no vitest.config.ts), então o `URL` global é o
// do jsdom, preso ao location fake "http://localhost:3000/": ele ignora a
// base file: e devolve outro esquema. dirname+join com fileURLToPath escapa
// disso porque não passa pelo construtor de URL relativa nenhuma vez.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const portais = existsSync(RAIZ)
  ? readdirSync(RAIZ, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name as Portal)
  : [];

describe("parsers contra e-mail real", () => {
  if (portais.length === 0) {
    it.todo("nenhum fixture ainda: rodar a varredura da Task 6 primeiro");
  }

  for (const portal of portais) {
    const dir = join(RAIZ, portal);
    const emls = readdirSync(dir).filter((f) => f.endsWith(".eml"));

    // Há fixture de OLX e Mercado Livre, mas eles não têm parser de propósito:
    // só mandam botão que exige login, e `processarEvento` corta antes de
    // chamar parser. O fixture fica para provar que continua sendo assim.
    if (!PORTAIS_COM_DADOS.includes(portal)) {
      describe(portal, () => {
        it("não tem parser, por decisão de projeto", () => {
          expect(parserDoPortal(portal)).toBeNull();
        });
      });
      continue;
    }

    describe(portal, () => {
      it("tem parser registrado", () => {
        expect(parserDoPortal(portal)).not.toBeNull();
      });

      for (const eml of emls) {
        it(`extrai ${eml}`, async () => {
          const email = paraEmailCru(await simpleParser(readFileSync(join(dir, eml))));
          const esperadoPath = join(dir, eml.replace(/\.eml$/, ".esperado.json"));
          const esperado = JSON.parse(readFileSync(esperadoPath, "utf8"));
          const parser = parserDoPortal(portal);
          expect(parser).not.toBeNull();
          expect(parser!(email)).toEqual(esperado);
        });
      }
    });
  }
});
