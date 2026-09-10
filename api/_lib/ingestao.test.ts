import { beforeEach, describe, expect, it, vi } from "vitest";

// O upsert real do Supabase é encadeável (`.upsert(...).select(...)`), não
// resolve direto: o dublê precisa reproduzir o encadeamento, senão o teste
// passa contra um mock que nunca bateria com o código de produção.
const select = vi.fn();
const upsert = vi.fn(() => ({ select }));
const from = vi.fn(() => ({ upsert }));
vi.mock("./supabase", () => ({ getSupabase: () => ({ from }) }));

const { ingerir } = await import("./ingestao");

const base = {
  messageId: "<abc@webmotors.com.br>",
  remetente: "leads@webmotors.com.br",
  assunto: "Novo lead",
  recebidoEm: "2026-09-10T12:00:00.000Z",
  texto: "corpo",
  html: "<p>corpo</p>",
  anexos: [],
};

describe("ingerir", () => {
  beforeEach(() => {
    upsert.mockClear();
    from.mockClear();
    select.mockReset();
    select.mockResolvedValue({ data: [{ id: 1 }], error: null });
  });

  it("grava e-mail de portal conhecido", async () => {
    expect(await ingerir(base, 1)).toBe("gravado");
    expect(from).toHaveBeenCalledWith("portais_eventos_raw");
  });

  it("descarta e-mail que não é de portal, sem tocar no banco", async () => {
    const outro = { ...base, remetente: "contador@escritorio.com.br" };
    expect(await ingerir(outro, 1)).toBe("ignorado");
    expect(from).not.toHaveBeenCalled();
  });

  it("descarta e-mail sem messageId, que não teria como deduplicar", async () => {
    expect(await ingerir({ ...base, messageId: "" }, 1)).toBe("ignorado");
    expect(from).not.toHaveBeenCalled();
  });

  it("reconhece duplicado quando o upsert não devolve linha nova", async () => {
    select.mockResolvedValue({ data: [], error: null });
    expect(await ingerir(base, 1)).toBe("duplicado");
  });

  it("estoura quando o supabase devolve erro, em vez de engolir", async () => {
    select.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(ingerir(base, 1)).rejects.toThrow("boom");
  });
});
