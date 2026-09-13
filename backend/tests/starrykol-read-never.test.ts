import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConn, resetConn } from "../src/db.js";
import { seedAll } from "../src/seed.js";
import { seedWorkbenchFixtures } from "../src/seed-fixtures.js";
import {
  isStarryKolReadTask,
  isStarryKolWriteTask,
  setEmailMcpClientFactory,
  STARRY_KOL_READ_TASKS,
} from "../src/starrykol/service.js";
import type { Json } from "../src/types.js";
import { CodexUnavailable } from "../src/worker/errors.js";
import { completeTurnItems, hasUsableStarryReadResult, starryReadBlockedByApproval } from "../src/worker/session-items.js";

const WRITE_TOOLS = ["sendEmailNow", "changeLifecycleStage", "decryptKolContact", "updateKolProfile", "addKolProfile"];
const calls: Array<{ name: string; args: Json }> = [];

function mockClient() {
  return {
    async callTool(name: string, args: Json = {}): Promise<Json> {
      calls.push({ name, args });
      if (WRITE_TOOLS.includes(name)) {
        throw new Error(`write tool ${name} must stay gated under approvalPolicy=never`);
      }
      if (name === "pageKolProfiles") {
        return {
          data: {
            pageNo: 1,
            pageSize: 20,
            total: 1,
            list: [{
              kolUid: "KOLTEST001",
              kolName: "户外电源达人",
              ownerUserName: "陈组长",
              cooperationStageName: "初步接触",
            }],
          },
        };
      }
      if (name === "getKolProfileSidebarMetrics") {
        return { data: { creatorCount: 12, stageCount: 6, riskConversationCount: 2 } };
      }
      if (name === "pageRiskConversations") {
        return { data: { total: 1, list: [{ id: 201, kolUid: "KOLRISK001", subject: "风险跟进", riskTag: "DELAY" }] } };
      }
      if (name === "summarizeRiskConversations") {
        return { data: { total: 1, summary: "1 条风险会话待处理。" } };
      }
      throw new Error(`unexpected tool ${name}`);
    },
    async close() { /* noop */ },
  };
}

describe("Starry KOL L1 reads under approvalPolicy never", () => {
  let tmp = "";
  let previousMode: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lingong-read-never-"));
    process.env.LINGONG_DB = path.join(tmp, "read-never.db");
    process.env.LINGONG_DATA = tmp;
    previousMode = process.env.CODEX_MODE;
    process.env.CODEX_MODE = "real";
    calls.length = 0;
    setEmailMcpClientFactory(mockClient);
    resetConn();
    seedAll();
    seedWorkbenchFixtures();
  });

  afterEach(() => {
    setEmailMcpClientFactory();
    resetConn();
    if (previousMode === undefined) delete process.env.CODEX_MODE;
    else process.env.CODEX_MODE = previousMode;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("classifies 达人库查询 and 风险扫描 as Host-backed reads", () => {
    expect(STARRY_KOL_READ_TASKS).toEqual(expect.arrayContaining([
      "creator_library_query",
      "risk_scan",
      "creator_risk_conversations",
    ]));
    expect(isStarryKolReadTask("creator_library_query")).toBe(true);
    expect(isStarryKolReadTask("risk_scan")).toBe(true);
    expect(isStarryKolWriteTask("email_compose")).toBe(true);
    expect(isStarryKolWriteTask("creator_contact_decrypt")).toBe(true);
    expect(isStarryKolWriteTask("creator_status_update")).toBe(true);
    expect(isStarryKolReadTask("creator_contact_decrypt")).toBe(false);
  });

  it("treats Codex approval-never cards as unusable read results", () => {
    expect(starryReadBlockedByApproval({
      error: "tool needs approval but approval_policy=never / 禁止审批",
    })).toBe(true);
    expect(hasUsableStarryReadResult([{
      type: "task_result",
      title: "达人库查询未完成",
      starrykol_data: { error: "approval_policy=never" },
    }])).toBe(false);
    expect(hasUsableStarryReadResult([{
      type: "task_result",
      starrykol_data: { list: [{ kolName: "户外电源达人" }], total: 1 },
    }])).toBe(true);
  });

  it("Host-reads pageKolProfiles when Codex produced no starry payload", async () => {
    const log: Json[] = [];
    const seen: Array<{ name: string; status: string }> = [];
    const items = await completeTurnItems(
      "creator_library_query",
      { raw: "查询达人库 关键词：户外电源" },
      [],
      log,
      (progress) => {
        if (progress.operation) seen.push({ name: progress.operation.name, status: progress.operation.status });
      },
    );
    expect(calls.map((row) => row.name)).toEqual(["pageKolProfiles", "getKolProfileSidebarMetrics"]);
    expect(calls.map((row) => row.name).some((name) => WRITE_TOOLS.includes(name))).toBe(false);
    const card = items.find((item) => item.type === "task_result");
    expect(card).toMatchObject({
      title: "达人库查询结果",
      skill: "creator_library_query",
    });
    expect(String(card?.summary)).toContain("1 条");
    expect(JSON.stringify(card?.sections)).toContain("户外电源达人");
    expect(card?.operations).toEqual([
      expect.objectContaining({ name: "starrykol.pageKolProfiles", status: "done" }),
      expect.objectContaining({ name: "starrykol.getKolProfileSidebarMetrics", status: "done" }),
    ]);
    expect(log).toContainEqual(expect.objectContaining({
      method: "mcp/starrykol",
      params: expect.objectContaining({ task: "creator_library_query", source: "host_read" }),
    }));
    expect(seen.some((row) => row.name === "starrykol.pageKolProfiles" && row.status === "done")).toBe(true);
  });

  it("replaces an approval-never Codex card with Host pageKolProfiles data", async () => {
    const items = await completeTurnItems(
      "creator_library_query",
      { raw: "查询达人库" },
      [{
        type: "task_result",
        title: "达人库查询未完成",
        summary: "工具需要审批但当前政策禁止审批（approval_policy=never）",
        starrykol_data: { error: "禁止审批", metrics: { approval_policy: "never" } },
      }],
      [],
    );
    const card = items.find((item) => item.type === "task_result");
    expect(card?.title).toBe("达人库查询结果");
    expect(String(card?.summary)).not.toMatch(/未完成|禁止审批|数据限制/);
    expect(JSON.stringify(card?.sections)).toContain("户外电源达人");
    expect(calls.map((row) => row.name)).toContain("pageKolProfiles");
  });

  it("Host-reads pageRiskConversations and summarizeRiskConversations for 风险扫描", async () => {
    const items = await completeTurnItems("risk_scan", { raw: "超时/风险扫描" }, [], []);
    expect(calls.map((row) => row.name)).toEqual(["pageRiskConversations", "summarizeRiskConversations"]);
    expect(calls.map((row) => row.name).some((name) => WRITE_TOOLS.includes(name))).toBe(false);
    const card = items.find((item) => item.type === "task_result");
    expect(card).toMatchObject({ title: "超时/风险扫描", skill: "risk_scan" });
    expect(JSON.stringify(card?.sections)).toContain("风险汇总");
    expect(JSON.stringify(card?.sections)).toContain("T8 失联与延期");
    expect(JSON.stringify(card?.sections)).toContain("小美妆日记");
    expect(card?.operations).toEqual([
      expect.objectContaining({ name: "starrykol.pageRiskConversations", status: "done" }),
      expect.objectContaining({ name: "starrykol.summarizeRiskConversations", status: "done" }),
    ]);
    const overdue = getConn().prepare("SELECT handle FROM collaborations WHERE overdue = 1").all() as { handle: string }[];
    expect(overdue.some((row) => row.handle === "小美妆日记")).toBe(true);
  });

  it("keeps write skills Codex-strict in real mode", async () => {
    await expect(completeTurnItems("email_compose", { raw: "写合作邮件" }, [], [])).rejects.toBeInstanceOf(CodexUnavailable);
    await expect(completeTurnItems("creator_contact_decrypt", { raw: "解密达人联系方式", entities: { kolUid: "KOLTEST001" } }, [], []))
      .rejects.toBeInstanceOf(CodexUnavailable);
    await expect(completeTurnItems("creator_status_update", { raw: "更新达人状态", entities: { kolUid: "KOLTEST001", status: "已签约" } }, [], []))
      .rejects.toBeInstanceOf(CodexUnavailable);
    await expect(completeTurnItems("creator_library_sync", { raw: "添加达人", entities: { name: "新测试达人", email: "new@example.com" } }, [], []))
      .rejects.toBeInstanceOf(CodexUnavailable);
    expect(calls).toEqual([]);
  });
});
