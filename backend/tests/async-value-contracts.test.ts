import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asyncEvery, asyncFilter, asyncFind, asyncFlatMap, asyncSome } from "../src/async-collections.js";
vi.mock("../mcp/tools.js", () => ({ READ_ONLY_ANNOTATIONS: { readOnlyHint: true } }));
import { serveMcpStdio } from "../mcp/stdio.js";
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); };

describe("resolved async collection contracts", () => {
  it("never treats a denied Promise as permission truth", async () => {
    expect(await asyncFilter([1, 2], async () => false)).toEqual([]);
    expect(await asyncSome([1, 2], async () => false)).toBe(false);
    expect(await asyncEvery([1, 2], async value => value === 1)).toBe(false);
    expect(await asyncFind([1, 2], async () => false)).toBeUndefined();
  });
  it("preserves order and awaits one-level flattening", async () => {
    const calls: number[] = [];
    const result = await asyncFlatMap([1, 2, 3], async value => {
      calls.push(value);
      await Promise.resolve();
      return value === 2 ? [] : [value, value * 10];
    });
    expect(calls).toEqual([1, 2, 3]);
    expect(result).toEqual([1, 10, 3, 30]);
    expect(result.every(value => typeof value === "number")).toBe(true);
  });
  it("preserves sparse flatMap semantics and thisArg", async () => {
    const sparse = [1, , 3];
    const calls: number[] = [];
    const result = await asyncFlatMap(sparse, async function (this: { multiplier: number }, value, index) {
      calls.push(index);
      return [Number(value) * this.multiplier];
    }, { multiplier: 2 });
    expect(calls).toEqual([0, 2]);
    expect(result).toEqual([2, 6]);
  });
  it("propagates rejected access checks instead of inventing an empty success", async () => {
    const error = new Error("authoritative source unavailable");
    await expect(asyncFilter([1], async () => { throw error; })).rejects.toBe(error);
    await expect(asyncFlatMap([1], async () => { throw error; })).rejects.toBe(error);
  });
  it("short-circuits some and every only after awaiting actual results", async () => {
    const someCalls: number[] = [], everyCalls: number[] = [];
    expect(await asyncSome([1, 2, 3], async value => { someCalls.push(value); return value === 2; })).toBe(true);
    expect(someCalls).toEqual([1, 2]);
    expect(await asyncEvery([1, 2, 3], async value => { everyCalls.push(value); return value === 1; })).toBe(false);
    expect(everyCalls).toEqual([1, 2]);
  });
});

describe("MCP asynchronous ordered dispatch", () => {
  let receive: (chunk: string) => void;
  let output: string[];
  beforeEach(() => {
    output = [];
    vi.spyOn(process.stdin, "setEncoding").mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, "on").mockImplementation((event, listener) => {
      if (String(event) === "data") receive = listener;
      return process.stdin;
    });
    vi.spyOn(process.stdout, "write").mockImplementation(chunk => { output.push(String(chunk)); return true; });
  });
  afterEach(() => vi.restoreAllMocks());
  const tools = [{ name: "allowed", description: "isolated contract fixture", inputSchema: { type: "object", properties: {} } }];
  it("does not write a Promise placeholder before the tool has completed", async () => {
    let finish!: (value: { ok: boolean }) => void;
    const result = new Promise<{ ok: boolean }>(resolve => { finish = resolve; });
    const call = vi.fn(() => result);
    serveMcpStdio({ name: "fixture", tools, call, allow: ["allowed"] });
    receive(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "allowed", arguments: {} } }) + "\n");
    await flush();
    expect(call).toHaveBeenCalledTimes(1);
    expect(output).toEqual([]);
    finish({ ok: true });
    await flush();
    const message = JSON.parse(output[0]);
    expect(message.result.structuredContent).toEqual({ ok: true });
    expect(JSON.parse(message.result.content[0].text)).toEqual({ ok: true });
  });
  it("reports an async rejection and continues ordered dispatch of later messages", async () => {
    const call = vi.fn().mockRejectedValueOnce(new Error("real async failure")).mockResolvedValueOnce({ count: 2 });
    serveMcpStdio({ name: "fixture", tools, call });
    receive([1, 2].map(id => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "allowed", arguments: {} } })).join("\n") + "\n");
    await flush();
    const messages = output.map(line => JSON.parse(line));
    expect(messages.map(message => message.id)).toEqual([1, 2]);
    expect(messages[0].error).toMatchObject({ code: -32000, message: "real async failure" });
    expect(messages[1].result.structuredContent).toEqual({ count: 2 });
  });
  it("rejects a tool outside the allowlist before invoking its handler", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    serveMcpStdio({ name: "fixture", tools, call, allow: [] });
    receive(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "allowed", arguments: {} } }) + "\n");
    await flush();
    expect(call).not.toHaveBeenCalled();
    expect(JSON.parse(output[0]).error.message).toContain("not allowed");
  });
});
