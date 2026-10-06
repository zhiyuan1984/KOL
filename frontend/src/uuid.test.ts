import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUuid } from "./uuid";

describe("randomUuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to getRandomValues when randomUUID is unavailable on HTTP", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    expect(randomUuid()).toBe("00000000-0000-4000-8000-000000000000");
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });
});
