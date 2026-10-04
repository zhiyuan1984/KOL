import { describe, it, expect, vi } from "vitest";
import { operationRouter } from "../src/runtime/operations.js";
import { HttpFail } from "../src/host/errors.js";
import { api } from "../../frontend/src/api.js";

describe("registered operation transport", () => {
  function router() {
    const action = vi.fn((c, input) => c.json(input));
    const app = operationRouter([
      { id: "sample.read", kind: "query", handle: (c, input) => c.json(input) },
      { id: "sample.send", kind: "action", handle: action },
    ]);
    app.onError((error, c) => c.json({ error: error.message }, error instanceof HttpFail ? error.status as 400 : 500));
    return { app, action };
  }

  it("does not dispatch unregistered operations or actions through queries", async () => {
    const { app, action } = router();
    for (const path of ["/queries/sample.send", "/actions/sendEmailNow", "/actions/__proto__", "/skills/sample.send/execute"]) {
      const response = await app.request(path, { method: path.startsWith("/queries") ? "GET" : "POST", body: path.startsWith("/queries") ? undefined : "{}" });
      expect(response.status).toBe(404);
    }
    expect(action).not.toHaveBeenCalled();
  });

  it.each(["null", "[]", "bad json", '"text"'])("rejects malformed action input %s before dispatch", async (body) => {
    const { app, action } = router();
    expect((await app.request("/actions/sample.send", { method: "POST", body })).status).toBe(400);
    expect(action).not.toHaveBeenCalled();
  });

  it("keeps query inputs separate and disables caching", async () => {
    const { app } = router();
    const response = await app.request("/queries/sample.read?id=mail%2F1");
    expect(await response.json()).toEqual({ id: "mail/1" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("front-end sends the confirmation snapshot to the registered action", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await api.sendDraft("draft/1", { request_id: "req-1", confirmation_version: "snapshot-1" });
      const [path, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(path).toBe("/api/actions/mail.send");
      expect(JSON.parse(String(request.body))).toEqual({ draft_id: "draft/1", request_id: "req-1", confirmation_version: "snapshot-1" });
      await api.mailConversation("thread/1");
      expect(fetchMock.mock.calls[1][0]).toBe("/api/queries/mail.conversation?id=thread%2F1");
    } finally { vi.unstubAllGlobals(); }
  });
});
