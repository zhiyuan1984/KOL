import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUuid } from "../../frontend/src/uuid.js";

afterEach(() => vi.unstubAllGlobals());

describe("review request UUID compatibility", () => {
  it("uses the native method with its crypto receiver", () => {
    const provider = { randomUUID() { expect(this).toBe(provider); return "native-uuid"; } };
    vi.stubGlobal("crypto", provider);
    expect(randomUuid()).toBe("native-uuid");
  });
  it("generates UUID v4 without randomUUID using secure random bytes", () => {
    const provider = { getRandomValues(bytes: Uint8Array) { expect(this).toBe(provider); return bytes.fill(255); } };
    vi.stubGlobal("crypto", provider);
    expect(randomUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });
  it("does not substitute predictable randomness if crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => randomUuid()).toThrow("无法生成安全的请求标识");
  });
});
