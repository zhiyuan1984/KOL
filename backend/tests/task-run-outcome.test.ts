import { describe, expect, it } from "vitest";
import { taskRunOutcome } from "../src/tasks/run-outcome.js";

const saved = { failed: false, needsInput: false, workerStatus: "done", artifactKinds: ["task_result_card"] };
describe("automatic task outcome from execution facts", () => {
  it("automatically completes a saved result and a saved unsent draft", () => {
    expect(taskRunOutcome(saved).status).toBe("completed");
    expect(taskRunOutcome({ ...saved, artifactKinds: ["email_card"] }).status).toBe("completed");
  });
  it("never treats a model turn, an error card or an unavailable worker as completion", () => {
    expect(taskRunOutcome({ ...saved, artifactKinds: [] })).toEqual({ status: "failed", reason: "required_output_missing" });
    expect(taskRunOutcome({ ...saved, artifactKinds: ["error_card"] }).status).toBe("failed");
    expect(taskRunOutcome({ ...saved, workerStatus: "codex_unavailable" }).status).toBe("failed");
    expect(taskRunOutcome({ ...saved, workerStatus: "interrupted" }).status).toBe("failed");
    expect(taskRunOutcome({ ...saved, failed: true }).status).toBe("failed");
  });
  it("preserves real confirmation, asynchronous receipt and input waits", () => {
    expect(taskRunOutcome({ ...saved, actionStates: ["pending"] }).status).toBe("waiting_approval");
    expect(taskRunOutcome({ ...saved, actionStates: ["succeeded", "running"] }).status).toBe("running");
    expect(taskRunOutcome({ ...saved, actionStates: ["unknown"] }).status).toBe("uncertain");
    expect(taskRunOutcome({ ...saved, actionStates: ["uncertain"] }).status).toBe("uncertain");
    expect(taskRunOutcome({ ...saved, needsInput: true }).status).toBe("needs_clarification");
    expect(taskRunOutcome({ ...saved, actionStates: ["succeeded", "failed"] }).status).toBe("failed");
    expect(taskRunOutcome({ ...saved, actionStates: ["cancelled"] }).status).toBe("cancelled");
    expect(taskRunOutcome({ ...saved, actionStates: ["succeeded", "succeeded"] }).status).toBe("completed");
  });
});
