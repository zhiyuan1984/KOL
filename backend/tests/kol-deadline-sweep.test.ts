import { describe, expect, it } from "vitest";
import { selectDeadlineEvent, SWEEP_TEMPLATES } from "../src/ticket-domain/kol-deadline-sweep.js";
import { cronHandler, handlerContract, isCronHandlerKey } from "../src/cron/handlers.js";

/** deadline sweep 单测（无 PG 依赖）：事件选择纯函数 + handler 注册。 */
describe("kol deadline sweep", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  const day = 86_400_000;

  it("covers the deadline-driven templates", () => {
    expect([...SWEEP_TEMPLATES].sort()).toEqual(
      ["kol_production_followup", "kol_settlement_check"].sort(),
    );
  });

  it("production followup: overdue -> delayed, <3d -> near, else null", () => {
    expect(selectDeadlineEvent("kol_production_followup", now - day, now)).toBe("kol.production_delayed");
    expect(selectDeadlineEvent("kol_production_followup", now + 2 * day, now)).toBe("kol.production_deadline_near");
    expect(selectDeadlineEvent("kol_production_followup", now + 10 * day, now)).toBeNull();
    expect(selectDeadlineEvent("kol_production_followup", NaN, now)).toBeNull();
  });

  it("settlement check: <7d -> due, else null", () => {
    expect(selectDeadlineEvent("kol_settlement_check", now + 6 * day, now)).toBe("kol.settlement_due");
    expect(selectDeadlineEvent("kol_settlement_check", now - day, now)).toBe("kol.settlement_due");
    expect(selectDeadlineEvent("kol_settlement_check", now + 30 * day, now)).toBeNull();
  });

  it("unknown template -> null", () => {
    expect(selectDeadlineEvent("kol_script_review", now - day, now)).toBeNull();
  });

  it("registers the cron handler with a write contract", () => {
    expect(isCronHandlerKey("kol-deadline-sweep")).toBe(true);
    expect(typeof cronHandler("kol-deadline-sweep")).toBe("function");
    const contract = handlerContract("kol-deadline-sweep") as Record<string, unknown>;
    expect(contract.side_effect).toBe("write");
  });
});
