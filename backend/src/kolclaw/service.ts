import { audit } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { RemoteMcpClient } from "../mcp/remote.js";
import { codexMode, kolClawConfigured, kolClawMcpToken, kolClawMcpUrl } from "../config.js";
import { taskDefinition } from "../tasks/registry.js";
import { fieldLabel, missingFieldsMessage } from "../labels.js";
import type { Json } from "../types.js";

export const KOLCLAW_TASKS = [
  "creator_scoring",
  "creator_outreach",
  "creator_daily_tasks",
  "creator_budget_report",
] as const;

export type KolClawTask = (typeof KOLCLAW_TASKS)[number];

export function isKolClawTask(value: string | null | undefined): value is KolClawTask {
  return Boolean(value && (KOLCLAW_TASKS as readonly string[]).includes(value));
}
type KolClient = Pick<RemoteMcpClient, "callTool" | "close">;
let clientFactory: (() => KolClient) | null = null;

export function setKolClawClientFactory(factory?: () => KolClient): void {
  clientFactory = factory || null;
}

function json(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

export function normalizeKolClawResult(value: Json): Json {
  if (typeof value.result === "string") {
    try {
      const parsed = JSON.parse(value.result);
      return parsed && typeof parsed === "object" ? json(parsed) : { value: parsed };
    } catch {
      return { text: value.result };
    }
  }
  return value.result && typeof value.result === "object" ? json(value.result) : value;
}

function mockCall(name: string, args: Json): Json {
  const creator = {
    id: Number(args.creator_id || 1),
    name: String(args.name || "户外电源达人"),
    nickname: String(args.name || "户外电源达人"),
    followers: Number(args.followers || 85000),
    stable_views: 120000,
    score: 8,
    grade: "A",
    status: "待建联",
    expected_price: 1800,
  };
  if (name === "list_creators") return { total: 1, creators: [creator] };
  if (name === "add_creator") return { ok: true, creator: { ...creator, id: 101 }, created: true };
  if (name === "update_creator_status") return { ok: true, creator: { ...creator, status: args.status || creator.status } };
  if (name === "analyze_creators") return { total: 1, items: [creator], priority_uncontacted: [creator] };
  if (name === "analyze_creator") return creator;
  if (name === "generate_outreach_script") {
    return { ...creator, dm_script: "您好，想邀请您体验我们的户外电源产品。", wechat_script: "您好，期待进一步沟通合作。" };
  }
  if (name === "get_daily_tasks") return { total_tasks: 1, priority_uncontacted: [creator], pending_followup: [] };
  if (name === "get_budget_report") {
    return { campaign_id: Number(args.campaign_id || 1), project_name: "户外电源推广", total_budget: 45000, remaining_budget: 43200, pending: [creator] };
  }
  throw new Error(`unknown kol-claw tool: ${name}`);
}

async function call(name: string, args: Json): Promise<Json> {
  if (!clientFactory && codexMode() === "stub") return mockCall(name, args);
  if (!clientFactory && !kolClawConfigured()) {
    throw new HttpFail(503, {
      code: "kolclaw_not_configured",
      message: "KOL Claw 服务未配置。",
      next_action: "请配置 KOLCLAW_MCP_URL 和 KOLCLAW_MCP_TOKEN 后重启。",
    });
  }
  const client = clientFactory
    ? clientFactory()
    : new RemoteMcpClient({ url: kolClawMcpUrl(), token: kolClawMcpToken() });
  try {
    return normalizeKolClawResult(await client.callTool(name, args));
  } finally {
    await client.close().catch(() => undefined);
  }
}

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type Operation = { name: string; label: string; status: "running" | "done" | "failed" };

function creatorIdentity(entities: Json): Json {
  const name = String(entities.name || entities.creator_name || entities.handle || "").trim();
  const creatorId = number(entities.creator_id);
  return {
    ...(name ? { name } : {}),
    ...(creatorId ? { creator_id: creatorId } : {}),
  };
}

async function firstCreator(
  entities: Json,
  operations: Operation[],
  onOperation?: (operation: Operation) => void,
): Promise<Json> {
  const identity = creatorIdentity(entities);
  if (identity.name || identity.creator_id) return identity;
  const operation: Operation = { name: "kolclaw.list_creators", label: "选择达人", status: "running" };
  operations.push(operation);
  onOperation?.(operation);
  try {
    const listed = await call("list_creators", { limit: 1 });
    operation.status = "done";
    onOperation?.(operation);
    const creators = Array.isArray(listed.creators) ? listed.creators as Json[] : [];
    const first = creators[0] || {};
    const name = String(first.name || first.nickname || "").trim();
    const creatorId = number(first.id);
    if (!name && !creatorId) return { needs_input: true, missing_fields: ["name"] };
    return {
      ...(name ? { name } : {}),
      ...(creatorId ? { creator_id: creatorId } : {}),
    };
  } catch (error) {
    operation.status = "failed";
    onOperation?.(operation);
    throw error;
  }
}

function rows(data: Json): Json[] {
  for (const key of ["creators", "items", "priority_uncontacted", "pending", "pending_followup", "negotiating"]) {
    if (Array.isArray(data[key])) return data[key] as Json[];
  }
  if (data.nickname || data.name || data.dm_script || data.score != null) return [data];
  return [];
}

function rowText(row: Json): string {
  const name = String(row.nickname || row.name || `ID ${row.id || "—"}`);
  const details = [
    row.followers != null ? `粉丝 ${number(row.followers).toLocaleString("zh-CN")}` : "",
    row.score != null ? `评分 ${row.score}` : "",
    row.grade ? `等级 ${row.grade}` : "",
    row.status || row.outreach_status ? `状态 ${row.status || row.outreach_status}` : "",
    row.expected_price != null ? `建议价 ${row.expected_price}` : "",
  ].filter(Boolean);
  return `${name}${details.length ? ` · ${details.join(" · ")}` : ""}`;
}

function title(task: KolClawTask): string {
  return {
    creator_scoring: "达人评分与定价",
    creator_outreach: "达人建联话术",
    creator_daily_tasks: "今日 KOL 任务",
    creator_budget_report: "KOL 项目预算报告",
  }[task];
}

const TOOL_LABELS: Record<string, string> = {
  list_creators: "查询达人库",
  add_creator: "同步达人到跟进库",
  update_creator_status: "更新达人跟进状态",
  analyze_creators: "批量评分与定价",
  analyze_creator: "分析单个达人",
  generate_outreach_script: "生成建联话术",
  get_daily_tasks: "读取今日 KOL 任务",
  get_budget_report: "读取 KOL 预算报告",
};

export function kolClawResultCard(task: KolClawTask, data: Json): Json {
  const items = rows(data);
  const primitiveItems = Object.entries(data)
    .filter(([key, value]) => key !== "needs_input" && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 12)
    .map(([key, value]) => `${fieldLabel(key)}：${String(value)}`);
  const sections: Json[] = [];
  if (Array.isArray(data.missing_fields) && data.missing_fields.length) {
    sections.push({ title: "待补充字段", items: (data.missing_fields as unknown[]).map((field) => fieldLabel(String(field))) });
  }
  if (items.length) sections.push({ title: "明细", items: items.slice(0, 50).map(rowText) });
  if (primitiveItems.length) sections.push({ title: "摘要数据", items: primitiveItems });
  if (data.dm_script || data.wechat_script) {
    sections.unshift({
      title: "建联话术",
      body: [data.dm_script, data.wechat_script].filter(Boolean).join("\n\n"),
      items: [],
    });
  }
  return {
    type: "task_result",
    title: title(task),
    summary: data.needs_input
      ? missingFieldsMessage(data.missing_fields as unknown[] || [])
      : items.length ? `已返回 ${items.length} 条可核验记录。` : "KOL Claw 任务已完成。",
    sections,
    metrics: {
      ...(data.total != null ? { total: number(data.total) } : {}),
      ...(data.total_tasks != null ? { total_tasks: number(data.total_tasks) } : {}),
      ...(data.remaining_budget != null ? { remaining_budget: number(data.remaining_budget) } : {}),
    },
    recommended_actions: data.needs_input
      ? ["补充字段后重新运行该任务"]
      : task === "creator_outreach"
        ? ["人工复核话术后再创建发送任务"]
      : ["复核结果并选择下一步任务"],
    skill: task,
    profile: taskDefinition(task)?.profile || "lead",
    kolclaw_data: data,
    persistent: true,
  };
}

export async function executeKolClawTask(
  task: KolClawTask,
  entities: Json,
  actor = "host",
  onOperation?: (operation: Operation) => void,
): Promise<{
  data: Json;
  operations: Json[];
}> {
  const operations: Operation[] = [];
  const invoke = async (tool: string, args: Json): Promise<Json> => {
    const operation: Operation = { name: `kolclaw.${tool}`, label: TOOL_LABELS[tool] || title(task), status: "running" };
    operations.push(operation);
    onOperation?.(operation);
    try {
      const result = await call(tool, args);
      operation.status = "done";
      onOperation?.(operation);
      return result;
    } catch (error) {
      operation.status = "failed";
      onOperation?.(operation);
      throw error;
    }
  };
  let data: Json;
  if (task === "creator_scoring") {
    const identity = creatorIdentity(entities);
    data = identity.name || identity.creator_id
      ? await invoke("analyze_creator", { ...identity, target_cpm: number(entities.target_cpm, 15) })
      : await invoke("analyze_creators", {
        mode: String(entities.mode || "resource"),
        target_cpm: number(entities.target_cpm, 15),
        limit: Math.max(1, Math.min(100, number(entities.limit, 20))),
      });
  } else if (task === "creator_outreach") {
    const identity = await firstCreator(entities, operations, onOperation);
    data = identity.needs_input
      ? identity
      : await invoke("generate_outreach_script", {
        ...identity,
        wechat: String(entities.wechat || "[你的微信号]"),
        product: String(entities.product || "户外电源"),
      });
  } else if (task === "creator_daily_tasks") {
    data = await invoke("get_daily_tasks", {});
  } else {
    const campaignId = number(entities.campaign_id, 1);
    data = await invoke("get_budget_report", { campaign_id: campaignId });
  }
  audit(actor, `kolclaw.${task}`, {
    task,
    operations: operations.map((operation) => ({ name: operation.name, status: operation.status })),
    write: false,
  });
  return { data, operations };
}
