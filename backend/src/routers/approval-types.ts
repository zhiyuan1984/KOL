/**
 * Phase 2 审批类型管理（方案 §7.2 四件套：基本信息 / 表单设计 / 流程设计 / 版本发布）。
 */
import { Hono } from "hono";
import { postgresDb, nowIso, pgTransaction } from "../postgres/access.js";
import { audit } from "../postgres/access.js";
import { requireAdmin } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { testFlow, defaultExpenseFlow } from "../approval/flow-engine.js";
import type { ApprovalTypeRecord, FlowDefinition, FormFieldDef } from "../approval/flow-types.js";

export const approvalTypes = new Hono();

type Row = Record<string, unknown>;

function toRecord(row: Row): ApprovalTypeRecord {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    group: String(row.grp || ""),
    owner: String(row.owner || ""),
    visibility: String(row.visibility || "all"),
    form_schema: JSON.parse(String(row.form_schema || "[]")) as FormFieldDef[],
    flow: JSON.parse(String(row.flow || "{}")) as FlowDefinition,
    version: Number(row.version || 1),
    status: (row.status === "published" ? "published" : "draft") as "draft" | "published",
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
  };
}
approvalTypes.get("/admin/approval-types", async (c) => {
  (await requireAdmin());
  const rows = (await postgresDb().many("SELECT * FROM approval_types ORDER BY updated_at DESC")) as Row[];
  return c.json(rows.map(toRecord));
});
approvalTypes.get("/admin/approval-types/:id", async (c) => {
  (await requireAdmin());
  const row = (await postgresDb().one("SELECT * FROM approval_types WHERE id=$1", c.req.param("id"))) as Row | undefined;
  if (!row)
    throw new HttpFail(404, "Not Found");
  return c.json(toRecord(row));
});
approvalTypes.post("/admin/approval-types", async (c) => {
  const admin = (await requireAdmin());
  const body = (await c.req.json()) as Partial<ApprovalTypeRecord> & {
    code?: string;
  };
  const code = String(body.code || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (!code)
    throw new HttpFail(400, { code: "code_required", message: "编码必填（字母数字_-）。" });
  if (!String(body.name || "").trim())
    throw new HttpFail(400, { code: "name_required", message: "名称必填。" });
  const id = nid("apt");
  const now = nowIso();
  const flow = (body.flow && typeof body.flow === "object" ? body.flow : defaultExpenseFlow()) as FlowDefinition;
  // 发布前校验：结束节点前必须能走到 CEO（解释器自动补，校验流程连通性）
  const check = testFlow(flow, { requester_name: "黎玉燕", amount: 10000, currency: "CNY" });
  if (!check.ok && !String(check.error || "").includes("解析不到审批人")) {
    throw new HttpFail(400, { code: "flow_invalid", message: check.error || "流程定义无效。" });
  }
  try {
    (await postgresDb().execute("INSERT INTO approval_types (id,code,name,grp,owner,visibility,form_schema,flow,version,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,'draft',$9,$10)", id, code, String(body.name).trim(), String(body.group || ""), String(body.owner || ""), String(body.visibility || "all"), JSON.stringify(Array.isArray(body.form_schema) ? body.form_schema : []), JSON.stringify(flow), now, now));
  }
  catch {
    throw new HttpFail(409, { code: "code_exists", message: "编码已存在。" });
  }
  (await audit(admin.id, "admin.approval_type.create", { id, code }));
  const row = (await postgresDb().one("SELECT * FROM approval_types WHERE id=$1", id)) as Row;
  return c.json(toRecord(row));
});
approvalTypes.put("/admin/approval-types/:id", async (c) => {
  const admin = (await requireAdmin());
  const id = c.req.param("id");
  const cur = (await postgresDb().one("SELECT * FROM approval_types WHERE id=$1", id)) as Row | undefined;
  if (!cur)
    throw new HttpFail(404, "Not Found");
  if (String(cur.status) === "published") {
    throw new HttpFail(400, { code: "published_locked", message: "已发布版本锁定，请发布新版本。" });
  }
  const body = (await c.req.json()) as Partial<ApprovalTypeRecord>;
  const now = nowIso();
  const flow = (body.flow && typeof body.flow === "object" ? body.flow : JSON.parse(String(cur.flow || "{}"))) as FlowDefinition;
  (await pgTransaction(async (db) => {
    (await db.execute("UPDATE approval_types SET name=$1,grp=$2,owner=$3,visibility=$4,form_schema=$5,flow=$6,updated_at=$7 WHERE id=$8", String(body.name || cur.name).trim(), String(body.group ?? cur.grp ?? ""), String(body.owner ?? cur.owner ?? ""), String(body.visibility || cur.visibility || "all"), JSON.stringify(Array.isArray(body.form_schema) ? body.form_schema : JSON.parse(String(cur.form_schema || "[]"))), JSON.stringify(flow), now, id));
  }));
  (await audit(admin.id, "admin.approval_type.update", { id }));
  const row = (await postgresDb().one("SELECT * FROM approval_types WHERE id=$1", id)) as Row;
  return c.json(toRecord(row));
});
/** 发布新版本：draft -> published，version +1，运行中实例按旧版本走完（快照在 payload） */
approvalTypes.post("/admin/approval-types/:id/publish", async (c) => {
  const admin = (await requireAdmin());
  const id = c.req.param("id");
  const cur = (await postgresDb().one("SELECT * FROM approval_types WHERE id=$1", id)) as Row | undefined;
  if (!cur)
    throw new HttpFail(404, "Not Found");
  const flow = JSON.parse(String(cur.flow || "{}")) as FlowDefinition;
  // 发布前强制试运行（方案 §7.2，借鉴企微模拟提交）
  const body = (await c.req.json().catch(() => ({}))) as {
    test?: {
      amount?: number;
      currency?: string;
      requester_name?: string;
      brand?: string;
      region?: string;
    };
  };
  const t = body.test || { amount: 10000, currency: "CNY", requester_name: "黎玉燕" };
  const result = testFlow(flow, t);
  if (!result.ok) {
    throw new HttpFail(400, { code: "test_failed", message: `试运行未通过：${result.error}` });
  }
  const now = nowIso();
  const nextVersion = Number(cur.version || 1) + (String(cur.status) === "published" ? 1 : 0);
  (await postgresDb().execute("UPDATE approval_types SET status='published',version=$1,updated_at=$2 WHERE id=$3", nextVersion, now, id));
  (await audit(admin.id, "admin.approval_type.publish", {
    id, version: nextVersion,
    test_path: result.path,
    test_steps: result.steps.map((s) => s.name),
  }));
  const row = (await postgresDb().one("SELECT * FROM approval_types WHERE id=$1", id)) as Row;
  return c.json({ ...toRecord(row), test_result: result });
});
/** 试运行：输入测试值，返回命中路径与解析出的审批人 */
approvalTypes.post("/admin/approval-types/:id/test", async (c) => {
  (await requireAdmin());
  const id = c.req.param("id");
  const cur = (await postgresDb().one("SELECT * FROM approval_types WHERE id=$1", id)) as Row | undefined;
  if (!cur)
    throw new HttpFail(404, "Not Found");
  const body = (await c.req.json()) as {
    amount?: number;
    currency?: string;
    requester_name?: string;
    brand?: string;
    region?: string;
    fields?: Record<string, string | number>;
  };
  const flow = JSON.parse(String(cur.flow || "{}")) as FlowDefinition;
  return c.json(testFlow(flow, body));
});
approvalTypes.delete("/admin/approval-types/:id", async (c) => {
  const admin = (await requireAdmin());
  const id = c.req.param("id");
  const cur = (await postgresDb().one("SELECT * FROM approval_types WHERE id=$1", id)) as Row | undefined;
  if (!cur)
    throw new HttpFail(404, "Not Found");
  if (String(cur.status) === "published") {
    throw new HttpFail(400, { code: "published_locked", message: "已发布类型不可删除。" });
  }
  (await postgresDb().execute("DELETE FROM approval_types WHERE id=$1", id));
  (await audit(admin.id, "admin.approval_type.delete", { id }));
  return c.json({ ok: true });
});
