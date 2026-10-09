import { describe, expect, it } from "vitest";
import { cronExecutionCapability, cronPublicReadFields } from "../src/cron/public-read-model.js";
import type { TicketPrincipal } from "../src/ticket-domain/auth.js";
import type { Row } from "../src/types.js";

const employee: TicketPrincipal = {
  id: "employee-1",
  username: "employee",
  name: "员工",
  email: null,
  roles: [],
  active: true,
};

const admin: TicketPrincipal = { ...employee, id: "admin-1", roles: ["admin"] };

function job(overrides: Row = {}): Row {
  return {
    id: "cjob-1",
    owner_account_id: "employee-1",
    execute_as: "employee-1",
    handler_key: "overdue-scan",
    status: "published",
    condition_json: {},
    active_run_status: null,
    last_terminal_status: null,
    ...overrides,
  };
}

describe("cron employee public read model", () => {
  it("does not grant employees system-job mutations, while an administrator receives state-appropriate actions", () => {
    const systemPublished = job({ owner_account_id: null, execute_as: "system" });
    expect(cronPublicReadFields(systemPublished, employee)).toMatchObject({
      enabled: true,
      allowed_actions: { edit: false, pause: false, resume: false, publish: false, run_now: true },
    });

    const systemPaused = job({ owner_account_id: null, execute_as: "system", status: "paused" });
    expect(cronPublicReadFields(systemPaused, admin)).toMatchObject({
      allowed_actions: { edit: true, pause: false, resume: true, publish: false, run_now: false, run_reason: "仅已发布作业支持立即运行。" },
    });
  });

  it("keeps handler migration isolation explicit for all blocked contracts", () => {
    for (const handler_key of ["ai-task", "ownership-release", "mail-memory-increment"]) {
      const fields = cronPublicReadFields(job({ handler_key }), admin);
      expect(fields).toMatchObject({
        execution_capability: {
          ready: false,
          code: "blocked_pending_native_repository",
        },
        allowed_actions: { run_now: false },
      });
      expect((fields.allowed_actions as { run_reason?: string }).run_reason).toContain("已隔离");
    }
  });

  it("only exposes run-now for published, condition-enabled, non-active, capable jobs", () => {
    expect(cronPublicReadFields(job({ status: "paused" }), employee)).toMatchObject({
      allowed_actions: { run_now: false, run_reason: "仅已发布作业支持立即运行。" },
    });
    expect(cronPublicReadFields(job({ condition_json: { enabled: false } }), employee)).toMatchObject({
      enabled: false,
      allowed_actions: { run_now: false, run_reason: "作业条件已停用。" },
    });
    expect(cronPublicReadFields(job({ active_run_status: "queued" }), employee)).toMatchObject({
      allowed_actions: { run_now: false, run_reason: "已有运行正在排队或执行。" },
    });
    expect(cronPublicReadFields(job(), employee)).toMatchObject({
      execution_capability: { ready: true },
      allowed_actions: { run_now: true },
    });
  });

  it("uses persisted receipt semantics for the last-result label and does not invent a discovery queue receipt", () => {
    expect(cronPublicReadFields(job({
      handler_key: "discovery-search",
      last_terminal_status: "succeeded",
      last_result_receipt_json: { crawl_job_id: "crawl-42" },
    }), admin).last_result_label).toBe("已入队");
    expect(cronPublicReadFields(job({
      handler_key: "discovery-search",
      last_terminal_status: "succeeded",
      last_result_receipt_json: {},
    }), admin).last_result_label).toBe("待核对回执");
    expect(cronPublicReadFields(job({ handler_key: "ai-task", last_terminal_status: "succeeded" }), admin).last_result_label).toBe("已提交");
    expect(cronPublicReadFields(job({ last_terminal_status: "succeeded" }), employee).last_result_label).toBe("已完成");
  });

  it("fails closed for an unregistered handler", () => {
    expect(cronExecutionCapability(job({ handler_key: "not-registered" }))).toEqual({
      ready: false,
      code: "unknown_handler",
      reason: "处理器未登记，暂不可执行。",
    });
  });
});
