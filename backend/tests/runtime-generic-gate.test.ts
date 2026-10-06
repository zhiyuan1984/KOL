import { describe, expect, it } from "vitest";
import { assertRuntimeActionAllowed } from "../src/runtime/action-gates.js";

describe("generic runtime write gate", () => {
  it("lets unregistered write tools reach the employee confirmation", () => {
    expect(() => assertRuntimeActionAllowed("starrykol", "updateKolProfile")).not.toThrow();
    expect(() => assertRuntimeActionAllowed("starrykol", "starrykol.addKolProfile")).not.toThrow();
  });

  it("keeps sending and formal stage writes on their dedicated host paths", () => {
    for (const tool of ["sendEmailNow", "starrykol.sendEmailNow", "changeLifecycleStage", "change_lifecycle_stage"]) {
      expect(() => assertRuntimeActionAllowed("starrykol", tool)).toThrow();
    }
  });
});
