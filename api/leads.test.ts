import { beforeEach, describe, expect, it, vi } from "vitest";

const range = vi.fn();
const order = vi.fn(() => ({ range }));
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq, order }));
vi.mock("./_lib/supabase", () => ({ getSupabase: () => ({ from: () => ({ select }) }) }));

const { default: handler } = await import("./leads");

describe("GET /api/leads", () => {
  beforeEach(() => {
    range.mockReset();
    range.mockResolvedValue({ data: [], error: null });
  });

  it("responde json com a lista", async () => {
    const r = await handler(new Request("https://x/api/leads"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
  });

  it("aceita filtro por portal", async () => {
    await handler(new Request("https://x/api/leads?portal=webmotors"));
    expect(eq).toHaveBeenCalledWith("portal", "webmotors");
  });

  it("recusa portal fora do catálogo em vez de repassar ao banco", async () => {
    const r = await handler(new Request("https://x/api/leads?portal=inventado"));
    expect(r.status).toBe(400);
  });

  it("devolve 500 quando o supabase falha, sem mascarar como lista vazia", async () => {
    range.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await handler(new Request("https://x/api/leads"));
    expect(r.status).toBe(500);
  });
});
