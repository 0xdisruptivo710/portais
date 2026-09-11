// Ponto único de import dos parsers. Cada `import` abaixo é side-effect: o
// módulo chama `registrarParser` ao carregar. OLX e Mercado Livre não têm
// parser de propósito — só mandam botão que exige login, e `processarEvento`
// os trata como "lead sem dados" antes de chegar aqui.
import "./webmotors.js";
import "./chavesnamao.js";

export { parserDoPortal, registrarParser, leadVazio, type Parser } from "./registro.js";
