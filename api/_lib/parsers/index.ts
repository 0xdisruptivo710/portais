// Ponto único de import dos parsers. Uma tarefa futura acrescenta aqui
// uma linha `import "./webmotors.js";` por portal (o import side-effect
// registra o parser via `registrarParser`); por ora não há nenhum.
export { parserDoPortal, registrarParser, leadVazio, type Parser } from "./registro.js";
