import { describe, expect, it } from "vitest";
import { declaredToolRisk } from "../src/runtime/skill-coverage.js";

describe("declared policy risk precedence preserves real values and risk floors", () => {
  it("keeps a registered L1 read tool at L1", () => {
    expect(declaredToolRisk("pageKolProfiles", "L1")).toBe("L1");
  });
  it("keeps a registered L2 tool at L2", () => {
    expect(declaredToolRisk("pageKolProfiles", "L2")).toBe("L2");
  });
  it("keeps a registered L3 tool at L3", () => {
    expect(declaredToolRisk("pageKolProfiles", "L3")).toBe("L3");
  });
  it("cannot lower a known send action below its risk floor", () => {
    expect(declaredToolRisk("sendMail", "L1")).toBe("L3");
  });
  it("uses the declared-name fallback only when no valid policy exists", () => {
    expect(declaredToolRisk("pageKolProfiles")).toBe("L1");
    expect(declaredToolRisk("deleteMessage")).toBe("L3");
  });
});
