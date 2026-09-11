import { describe, expect, it } from "vitest";
import { isMissingInputDraft } from "../src/host/draft-quality.js";

describe("missing-input drafts", () => {
  it("rejects Codex asking for a collaboration ID as if it were an email", () => {
    expect(isMissingInputDraft(
      "Collaboration ID required",
      "Please provide the creator handle or collaboration ID so I can draft the check-in.",
    )).toBe(true);
    expect(isMissingInputDraft(
      "Outline check-in — family camping power",
      "Hi,\n\nChecking in on the family camping power outline.\n",
    )).toBe(false);
  });
});
