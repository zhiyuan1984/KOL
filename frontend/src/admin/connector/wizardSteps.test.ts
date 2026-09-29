import { describe, expect, it } from "vitest";
import { initialWizardStep } from "./wizardSteps";

describe("connector setup wizard entry step", () => {
  it("keeps a new connector on the save step", () => {
    expect(initialWizardStep("create")).toBe("save");
    expect(initialWizardStep("configure")).toBe("save");
  });

  it("opens a tested-but-disabled connector on the enable step", () => {
    expect(initialWizardStep("configure", { status: "verified", enabled: false })).toBe("enable");
  });

  it("opens an enabled connector on the enable step as well", () => {
    expect(initialWizardStep("configure", { status: "enabled", enabled: true })).toBe("enable");
  });

  it("sends a failed verification back to the test step", () => {
    expect(initialWizardStep("configure", { status: "verification_failed" })).toBe("test");
  });

  it("treats a saved-but-untested config as a save-step connector", () => {
    expect(initialWizardStep("configure", { status: "pending_verification" })).toBe("save");
    expect(initialWizardStep("configure", { status: "draft" })).toBe("save");
  });
});
