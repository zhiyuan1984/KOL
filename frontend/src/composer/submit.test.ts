import { beforeEach, describe, expect, it, vi } from "vitest";
import { assembleComposerText, submitFromText } from "./submit";
import { api } from "../api";

vi.mock("../api", () => ({
  api: {
    createTaskFromText: vi.fn(),
    runTask: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assembleComposerText", () => {
  it("appends context after a blank line", () => {
    expect(assembleComposerText("写跟进邮件", () => "当前页面：工作台")).toBe("写跟进邮件\n\n当前页面：工作台");
  });
  it("leaves the question alone without context", () => {
    expect(assembleComposerText("写跟进邮件", () => "")).toBe("写跟进邮件");
    expect(assembleComposerText("写跟进邮件")).toBe("写跟进邮件");
  });
  it("never appends context to an empty question", () => {
    expect(assembleComposerText("   ", () => "当前页面：工作台")).toBe("");
  });
});

describe("submitFromText", () => {
  it("runs create then run, and skips the run when the gate declines", async () => {
    mocked.createTaskFromText.mockResolvedValue({ task: { id: "t-1" } } as never);
    mocked.runTask.mockResolvedValue({ session_id: "s-1" } as never);
    const ok = await submitFromText({ text: "q", createBody: { source: "text" } });
    expect(mocked.createTaskFromText).toHaveBeenCalledWith({ text: "q", source: "text" });
    expect(mocked.runTask).toHaveBeenCalledWith("t-1", {});
    expect(ok.run).toEqual({ session_id: "s-1" });

    mocked.createTaskFromText.mockResolvedValue({ task: undefined } as never);
    const declined = await submitFromText({
      text: "q", createBody: {},
      shouldRun: () => false,
    });
    expect(declined.run).toBeUndefined();
    expect(mocked.runTask).toHaveBeenCalledTimes(1);
  });
});
