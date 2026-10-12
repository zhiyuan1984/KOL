import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documentMaxBytes, documentUploadBodyLimit } from "../src/knowledge/document-upload-limits.js";

const previous = process.env.KNOWLEDGE_DOC_MAX_BYTES;
afterEach(() => {
  if (previous === undefined) delete process.env.KNOWLEDGE_DOC_MAX_BYTES;
  else process.env.KNOWLEDGE_DOC_MAX_BYTES = previous;
});
function app() {
  const parsed = vi.fn();
  const app = new Hono();
  app.use("/upload", documentUploadBodyLimit);
  app.post("/upload", async c => { parsed(); return c.json({ length: (await c.req.arrayBuffer()).byteLength }); });
  return { app, parsed };
}
describe("knowledge multipart limit", () => {
  it("rejects a declared oversized body without invoking the upload parser", async () => {
    process.env.KNOWLEDGE_DOC_MAX_BYTES = "1024";
    const { app: handler, parsed } = app();
    const response = await handler.request("/upload", { method: "POST", headers: { "Content-Length": "70000" }, body: "x" });
    expect(response.status).toBe(413);
    expect((await response.json()).detail.code).toBe("knowledge_document_too_large");
    expect(parsed).not.toHaveBeenCalled();
  });
  it("rejects an oversized streamed body without Content-Length before parsing", async () => {
    process.env.KNOWLEDGE_DOC_MAX_BYTES = "1024";
    const { app: handler, parsed } = app();
    const response = await handler.request("/upload", { method: "POST", body: new Uint8Array(70000) });
    expect(response.status).toBe(413);
    expect(parsed).not.toHaveBeenCalled();
  });
  it("preserves a valid body for the next handler", async () => {
    process.env.KNOWLEDGE_DOC_MAX_BYTES = "1024";
    const { app: handler, parsed } = app();
    const response = await handler.request("/upload", { method: "POST", body: "valid body" });
    expect(response.status).toBe(200);
    expect((await response.json()).length).toBe(10);
    expect(parsed).toHaveBeenCalledOnce();
  });
  it.each(["invalid", "0", "-1", "Infinity"])("fails closed to the default for invalid configuration %s", value => {
    process.env.KNOWLEDGE_DOC_MAX_BYTES = value;
    expect(documentMaxBytes()).toBe(536870912);
  });
});
