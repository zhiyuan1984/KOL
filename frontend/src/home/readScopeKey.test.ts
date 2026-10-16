import { describe, expect, it } from "vitest";
import { readScopeKey } from "./readScopeKey";
import { sharedRead } from "./sharedRead";

describe("readScopeKey", () => {
  it("uses a stable account id and canonical authorization facts, not display metadata", () => {
    const first = readScopeKey({
      id: "usr-7",
      role: "employee",
      roles: ["kol", "employee"],
      brands: ["north", "east"],
      mailboxes: ["sales@example.test", "creator@example.test"],
      available_modes: ["employee", "admin"],
    });
    const reordered = readScopeKey({
      id: "usr-7",
      role: "employee",
      roles: ["employee", "kol", "employee"],
      brands: ["east", "north"],
      mailboxes: ["creator@example.test", "sales@example.test"],
      available_modes: ["admin", "employee"],
    });

    expect(reordered).toBe(first);
    expect(first).toContain("actor:usr-7");
    expect(first).toContain("roles:employee,kol");
  });

  it("separates changed authorization scope and never treats an unverified actor as an authenticated one", () => {
    const employee = readScopeKey({ id: "usr-7", roles: ["employee"], brands: ["north"] });
    const otherBrand = readScopeKey({ id: "usr-7", roles: ["employee"], brands: ["south"] });

    expect(otherBrand).not.toBe(employee);
    expect(readScopeKey({ name: "same display name" } as never)).toBe("actor:unverified");
    expect(readScopeKey(null)).not.toBe(employee);
  });

  it("keeps only same-scope callers on one in-flight private read", async () => {
    let calls = 0;
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    const firstScope = readScopeKey({ id: "usr-first", roles: ["employee"] });
    const secondScope = readScopeKey({ id: "usr-second", roles: ["employee"] });
    const firstKey = `home:${firstScope}:following`;
    const secondKey = `home:${secondScope}:following`;

    const first = sharedRead(firstKey, () => {
      calls += 1;
      return new Promise<string>((resolve) => { resolveFirst = resolve; });
    });
    const firstJoiner = sharedRead(firstKey, () => {
      calls += 1;
      return Promise.resolve("must not run");
    });
    const second = sharedRead(secondKey, () => {
      calls += 1;
      return new Promise<string>((resolve) => { resolveSecond = resolve; });
    });

    expect(calls).toBe(2);
    resolveFirst("first");
    resolveSecond("second");
    await expect(firstJoiner).resolves.toBe("first");
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });
});
