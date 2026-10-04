import { Hono, type Context } from "hono";
import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";

export type Operation = {
  id: string;
  kind: "query" | "action" | "skill" | "job";
  handle: (context: Context, input: Json) => Response | Promise<Response>;
};

/** Closed registration, never a client-selected URL, module, or MCP tool. The
 * domain handler retains current authorization and confirmation checks. */
export function operationRouter(operations: readonly Operation[]): Hono {
  const registry = new Map<string, Operation>();
  for (const operation of operations) {
    const key = `${operation.kind}:${operation.id}`;
    if (registry.has(key)) throw new Error(`Duplicate operation ${key}`);
    registry.set(key, operation);
  }
  const router = new Hono();
  for (const [kind, path] of [
    ["query", "/queries/:operation"], ["action", "/actions/:operation"],
    ["skill", "/skills/:operation/execute"], ["job", "/jobs/:operation/start"],
  ] as const) {
    router.on(kind === "query" ? "GET" : "POST", path, async (c) => {
      const operation = registry.get(`${kind}:${c.req.param("operation")}`);
      if (!operation) throw new HttpFail(404, { code: "operation_not_found" });
      c.header("Cache-Control", "no-store");
      let input: Json;
      if (kind === "query") input = c.req.query();
      else {
        let body: unknown;
        try { body = await c.req.json(); } catch { throw new HttpFail(400, "request body must be JSON"); }
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpFail(400, "request body must be an object");
        input = body as Json;
      }
      return operation.handle(c, input);
    });
  }
  return router;
}
