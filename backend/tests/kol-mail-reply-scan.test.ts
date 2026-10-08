import { describe, expect, it } from "vitest";
import { classifyReplyItem } from "../src/ticket-domain/kol-mail-reply-scan.js";
import { cronHandler, handlerContract, isCronHandlerKey } from "../src/cron/handlers.js";

/** mail reply scan 单测（无 PG 依赖）：跳过判定纯函数 + handler 注册。 */
describe("kol mail reply scan", () => {
  const base = {
    id: "lead_1", lead_stage: "contacting", is_archived: false,
    followup_task_id: "task_1", owner_principal_id: "user_1",
  };

  it("emits for a healthy open lead", () => {
    expect(classifyReplyItem(base)).toEqual({ action: "emit" });
  });

  it("skips unmatched / archived / converted / taskless / ownerless", () => {
    expect(classifyReplyItem(null)).toEqual({ action: "skip", reason: "lead_not_matched" });
    expect(classifyReplyItem({ ...base, is_archived: true })).toEqual({ action: "skip", reason: "lead_archived" });
    expect(classifyReplyItem({ ...base, lead_stage: "converted" })).toEqual({ action: "skip", reason: "lead_converted" });
    expect(classifyReplyItem({ ...base, followup_task_id: null })).toEqual({ action: "skip", reason: "lead_no_task" });
    expect(classifyReplyItem({ ...base, owner_principal_id: null })).toEqual({ action: "skip", reason: "lead_no_owner" });
  });

  it("registers the cron handler with a write contract", () => {
    expect(isCronHandlerKey("kol-mail-reply-scan")).toBe(true);
    expect(typeof cronHandler("kol-mail-reply-scan")).toBe("function");
    const contract = handlerContract("kol-mail-reply-scan") as Record<string, unknown>;
    expect(contract.side_effect).toBe("write");
    expect(contract.creates_session).toBe(false);
  });
});
