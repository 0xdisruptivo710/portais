import { describe, expect, it } from "vitest";
import { identificarPortal } from "./portal";

describe("identificarPortal", () => {
  it.each([
    ["leads@webmotors.com.br", "webmotors"],
    ["Webmotors <no-reply@Webmotors.com.br>", "webmotors"],
    ["contato@icarros.com.br", "icarros"],
    ["noreply@chavesnamao.com.br", "chavesnamao"],
    ["atendimento@comprecar.com.br", "comprecar"],
    ["nao-responda@olx.com.br", "olx"],
    ["lead@ml.olx.com.br", "olx"],
    ["noreply@mercadolivre.com.br", "mercadolivre"],
    ["nao-responda@mail.mercadolivre.com", "mercadolivre"],
    // O CARRO SP manda do domínio curto (carsp.com.br) e anuncia no longo
    // (carrosp.com.br): os dois são a mesma casa e o e-mail real cita os dois.
    ["CARRO SP <noreply@carsp.com.br>", "carrosp"],
    ["contato@carrosp.com.br", "carrosp"],
    ["Usadosbr <propostas@usadosbr.com>", "usadosbr"],
    // Domínio de marketing da OLX. É outra casa que a olx.com.br, e é por
    // isso que a regra de domínio completo o deixava de fora.
    ["OLX <dicas@newsolx.com.br>", "olxchat"],
  ])("reconhece %s como %s", (remetente, esperado) => {
    expect(identificarPortal(remetente)).toBe(esperado);
  });

  it("ignora e-mail que não é de portal", () => {
    expect(identificarPortal("contador@escritorio.com.br")).toBeNull();
    expect(identificarPortal("noreply@nubank.com.br")).toBeNull();
  });

  it("não casa por substring solta no meio do endereço", () => {
    // "olx" dentro de outra palavra não pode virar lead da OLX
    expect(identificarPortal("suporte@folxcarros.com.br")).toBeNull();
  });

  it("newsolx é portal próprio, não a OLX: os assuntos são de famílias diferentes", () => {
    // Os dois domínios são da OLX, mas mandam templates diferentes e por isso
    // têm padrão de assunto próprio em ehLead.ts. Confundi-los faria o portão
    // de um barrar o lead do outro.
    expect(identificarPortal("dicas@newsolx.com.br")).not.toBe("olx");
    expect(identificarPortal("noreply@olx.com.br")).not.toBe("olxchat");
  });

  it("aguenta remetente vazio ou malformado", () => {
    expect(identificarPortal("")).toBeNull();
    expect(identificarPortal("sem-arroba")).toBeNull();
  });
});
