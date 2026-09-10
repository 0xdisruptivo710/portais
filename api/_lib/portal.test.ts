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

  it("aguenta remetente vazio ou malformado", () => {
    expect(identificarPortal("")).toBeNull();
    expect(identificarPortal("sem-arroba")).toBeNull();
  });
});
