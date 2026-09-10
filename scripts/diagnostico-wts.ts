import { wtsRequest } from "../api/_lib/wts.js";

const sessoes = (await wtsRequest("GET", "/chat/v2/session?PageSize=50")) as {
  items?: { windowStatus?: string; lastMessageIn?: string }[];
};

const itens = sessoes.items ?? [];
const ativas = itens.filter((s) => s.windowStatus === "ACTIVE");
const paradas = itens.filter((s) => {
  if (!s.lastMessageIn) return false;
  return Date.now() - new Date(s.lastMessageIn).getTime() > 48 * 3600 * 1000;
});
const paradasAtivas = paradas.filter((s) => s.windowStatus === "ACTIVE");

console.log(`sessões: ${itens.length} | ACTIVE: ${ativas.length}`);
console.log(`paradas há mais de 48h: ${paradas.length} | dessas, ACTIVE: ${paradasAtivas.length}`);
console.log(
  paradas.length > 0 && paradasAtivas.length === paradas.length
    ? "\nCANAL NAO OFICIAL: não existe janela de 24h. Texto livre entrega, sem template."
    : "\nCANAL PROVAVELMENTE OFICIAL: primeiro contato ativo exige template aprovado.",
);
