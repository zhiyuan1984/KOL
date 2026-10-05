import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../frontend/src/api.js";

afterEach(() => vi.unstubAllGlobals());

describe("home board HTTP error contract", () => {
  it("retains the HTTP status when a gateway returns HTML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad Gateway</html>", {
      status: 502, headers: { "content-type": "text/html" },
    })));
    await expect(api.homeBoard()).rejects.toMatchObject({ status: 502, message: "请求失败 (502)" });
  });

  it("rejects a JSON error instead of treating it as an empty board", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "当前范围无权读取" }), {
      status: 403, headers: { "content-type": "application/json" },
    })));
    await expect(api.homeBoard()).rejects.toMatchObject({ status: 403, message: "当前范围无权读取" });
  });

  it("preserves the refreshed success payload and bypasses the browser cache", async () => {
    const payload = { kols: [], workbench: { lifecycle_complete: true } };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetch);
    await expect(api.homeBoard({ refresh: true })).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledWith("/api/home/board?refresh=1", expect.objectContaining({
      cache: "no-store",
    }));
  });
});
