import { describe, expect, it } from "vitest";
import { nativeTicketAllowedActions } from "../src/ticket-domain/read-tickets.js";

describe("task projection shares native ticket command eligibility", () => {
  it("permits only the pending ticket creator to cancel", () => {
    const row = { owner_user_id: "creator", assignee_user_id: "assignee", status: "pending" };
    expect(nativeTicketAllowedActions(row, "creator")).toContain("cancel");
    expect(nativeTicketAllowedActions(row, "assignee")).not.toContain("cancel");
    expect(nativeTicketAllowedActions(row, "unrelated")).not.toContain("cancel");
    for (const status of ["accepted", "running", "waiting", "completed", "failed", "cancelled"]) {
      expect(nativeTicketAllowedActions({ ...row, status }, "creator")).not.toContain("cancel");
    }
  });
});
