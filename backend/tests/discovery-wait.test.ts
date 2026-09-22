import { describe, expect, it } from "vitest";
import { isDiscoveryTerminal, isDiscoveryTerminalStatus } from "../../frontend/src/home/discovery.js";

describe("isDiscoveryTerminal", () => {
  it("does not treat queued/running or candidate rows as complete", () => {
    expect(isDiscoveryTerminalStatus("queued")).toBe(false);
    expect(isDiscoveryTerminalStatus("running")).toBe(false);
    expect(isDiscoveryTerminal({
      status: "running",
      request: { id: "dreq_1", status: "running", keywords: [], platforms: [] },
      run: { id: "drun_1", status: "running" },
    })).toBe(false);
    expect(isDiscoveryTerminal({
      status: "open",
      request: { id: "dreq_1", status: "open", keywords: [], platforms: [] },
      run: { id: "drun_1", status: "queued" },
    })).toBe(false);
  });

  it("is terminal only on succeeded/failed/cancelled", () => {
    expect(isDiscoveryTerminal({
      status: "succeeded",
      request: { id: "dreq_1", status: "succeeded", keywords: [], platforms: [] },
      run: { id: "drun_1", status: "succeeded" },
    })).toBe(true);
    expect(isDiscoveryTerminal({
      status: "failed",
      request: { id: "dreq_1", status: "failed", keywords: [], platforms: [] },
      run: { id: "drun_1", status: "failed" },
    })).toBe(true);
    expect(isDiscoveryTerminal({
      status: "failed",
      request: { id: "dreq_1", status: "failed", keywords: [], platforms: [] },
      run: null,
    })).toBe(true);
  });
});
