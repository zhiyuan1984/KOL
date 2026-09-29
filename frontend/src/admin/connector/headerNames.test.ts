import { describe, expect, it } from "vitest";
import {
  COMMON_HEADER_NAMES,
  headerNameHint,
  otherHeaderNames,
  suggestHeaderNames,
  validateHeaderName,
} from "./headerNames";

describe("header name validation", () => {
  it("accepts every suggested header name", () => {
    for (const name of COMMON_HEADER_NAMES) expect(validateHeaderName(name)).toBe("");
  });

  it("keeps rejecting reserved names and non-token characters", () => {
    expect(validateHeaderName("host")).toContain("由传输层保留");
    expect(validateHeaderName("Content-Length")).toContain("由传输层保留");
    expect(validateHeaderName("X MCP API KEY")).toContain("token 字符");
  });
});

describe("header name suggestions", () => {
  it("drops the names other rows already use, ignoring case", () => {
    expect(suggestHeaderNames(["authorization", "X-API-Key"])).toEqual(["X-MCP-API-KEY", "Content-Type", "Accept"]);
    expect(suggestHeaderNames(["x-mcp-api-key"])).not.toContain("X-MCP-API-KEY");
  });

  it("ignores blank and whitespace-only names", () => {
    expect(suggestHeaderNames(["", "   "])).toEqual([...COMMON_HEADER_NAMES]);
  });

  it("reads the names of the other rows only", () => {
    const rows = [{ name: "Authorization" }, { name: "" }, { name: "Accept" }];
    // 当前行的名字不算被占用；其他行（含空格名）才进 taken。
    expect(otherHeaderNames(rows, 0)).toEqual(["", "Accept"]);
    expect(suggestHeaderNames(otherHeaderNames(rows, 0))).toEqual(["X-MCP-API-KEY", "Authorization", "Content-Type"]);
  });
});

describe("header name hints", () => {
  it("always explains the Bearer prefix, and the replacement only when a bearer reference exists", () => {
    expect(headerNameHint("Authorization")).toContain("自带 Bearer 前缀");
    expect(headerNameHint("authorization")).not.toContain("替换");
    expect(headerNameHint("Authorization", { bearerReference: true })).toContain("替换已配置的 Bearer 引用");
  });

  it("explains the vault behaviour for known names and stays quiet for custom ones", () => {
    expect(headerNameHint("X-MCP-API-KEY")).toContain("凭据保险库");
    expect(headerNameHint("Content-Type")).toContain("传输层");
    expect(headerNameHint("X-API-Key")).toBe("");
    expect(headerNameHint("  ")).toBe("");
  });
});
