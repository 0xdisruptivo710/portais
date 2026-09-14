// Ponto único de import dos parsers. Cada `import` abaixo é side-effect: o
// módulo chama `registrarParser` ao carregar. OLX, Mercado Livre e o aviso de
// chat da OLX (olxchat) não têm parser de propósito — só mandam botão que
// exige login, e `processarEvento` os trata como "lead sem dados" antes de
// chegar aqui.
import "./webmotors.js";
import "./chavesnamao.js";
import "./comprecar.js";
import "./carrosp.js";
import "./usadosbr.js";

export { parserDoPortal, registrarParser, leadVazio, type Parser } from "./registro.js";
