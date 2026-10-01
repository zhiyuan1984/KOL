import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConn, type SqliteConn } from "./db.js";
import type { Row } from "./types.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLASSIFIED_FLAG = "tickets_classified_v1";

export type TicketStatus = "open" | "in_progress" | "waiting" | "done" | "failed" | "cancelled";

/**
 * tickets.status → 展示用「工单状态」（派生，仅供工单视图/接口投影）。
 * 正式状态仍以 tickets.status 为准；未知值返回 null。
 */
export function ticketStatusFromWorkItem(status: string): TicketStatus | null {
  switch (String(status)) {
    case "pending":
    case "needs_clarification":
      return "open";
    case "queued":
    case "starting":
    case "running":
    case "in_progress":
      return "in_progress";
    case "waiting":
    case "waiting_approval":
      return "waiting";
    case "completed":
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
    case "stopped":
      return "cancelled";
    default:
      return null;
  }
}

type TicketChannelRule = {
  code: string;
  order: number;
  fallback: boolean;
  taskTypes: Set<string>;
  sources: Set<string>;
};

type TicketTypesConfig = {
  version: number;
  taskTypeToKind: Map<string, string>;
  rules: TicketChannelRule[];
  fallbackChannel: string;
};

let cached: { file: string; mtime: number; config: TicketTypesConfig } | null = null;

export function ticketTypesPath(): string {
  return process.env.TICKET_TYPES_PATH || path.join(repoRoot, "config", "ticket-types.yaml");
}

export function resetTicketTypesCache(): void {
  cached = null;
}

export function loadTicketTypes(options: { refresh?: boolean } = {}): TicketTypesConfig | null {
  const file = ticketTypesPath();
  if (!fs.existsSync(file)) {
    console.warn(`[tickets] 票型目录不存在：${file}（使用兜底分类 general/human）`);
    return null;
  }
  const mtime = fs.statSync(file).mtimeMs;
  if (!options.refresh && cached && cached.file === file && cached.mtime === mtime) return cached.config;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as {
      version?: number;
      kinds?: Array<{ code?: string; match?: { task_type?: string[] } }>;
      channels?: Array<{
        code?: string;
        order?: number;
        fallback?: boolean;
        match?: { task_type?: string[]; source?: string[] };
      }>;
    };
    const taskTypeToKind = new Map<string, string>();
    for (const kind of raw.kinds || []) {
      for (const type of kind?.match?.task_type || []) {
        if (!taskTypeToKind.has(type)) taskTypeToKind.set(String(type), String(kind?.code || "general"));
      }
    }
    const rules = (raw.channels || []).map((channel, index) => ({
      code: String(channel?.code || "human"),
      order: Number.isFinite(Number(channel?.order)) ? Number(channel.order) : index,
      fallback: channel?.fallback === true,
      taskTypes: new Set((channel?.match?.task_type || []).map(String)),
      sources: new Set((channel?.match?.source || []).map(String)),
    })).sort((a, b) => a.order - b.order);
    const fallbackChannel = rules.find((rule) => rule.fallback)?.code || "human";
    const config: TicketTypesConfig = {
      version: Number(raw.version || 1),
      taskTypeToKind,
      rules,
      fallbackChannel,
    };
    cached = { file, mtime, config };
    return config;
  } catch (error) {
    console.warn(`[tickets] 票型目录解析失败：${file}：${(error as Error).message}（使用兜底分类 general/human）`);
    return null;
  }
}

export function classifyTicket(row: { task_type?: unknown; source?: unknown }): { kind: string; channel: string } {
  const config = loadTicketTypes();
  const taskType = String(row?.task_type || "");
  const source = String(row?.source || "");
  if (!config) return { kind: "general", channel: "human" };
  const kind = config.taskTypeToKind.get(taskType) || "general";
  for (const rule of config.rules) {
    if (rule.fallback) continue;
    if (rule.taskTypes.has(taskType) || rule.sources.has(source)) return { kind, channel: rule.code };
  }
  return { kind, channel: config.fallbackChannel };
}

function requesterTypeForChannel(channel: string): "human" | "agent" | "system" {
  if (channel === "system") return "system";
  if (channel === "agent") return "agent";
  return "human";
}

/**
 * 确保一张工单带上票型分类（tickets 即工单表：kind/channel 是表内列）。
 * 在创建路径 INSERT 之后调用：幂等，只写分类与提单列，不碰状态、运行与归属字段；
 * 分类只来自 config/ticket-types.yaml。
 */
export function ensureTicketForWorkItem(ticketId: string, options: { conn?: SqliteConn } = {}): void {
  const conn = options.conn || getConn();
  const row = conn.prepare(
    "SELECT id, task_type, source, owner_user_id, collaboration_id FROM tickets WHERE id=?",
  ).get(ticketId) as Row | undefined;
  if (!row) return;
  const { kind, channel } = classifyTicket(row);
  const requesterType = requesterTypeForChannel(channel);
  const collaborationId = row.collaboration_id ? String(row.collaboration_id) : null;
  conn.prepare(
    "UPDATE tickets SET kind=?, channel=?, requester_type=?, requester_id=?, object_type=?, object_id=?, kind_version=? WHERE id=?",
  ).run(
    kind,
    channel,
    requesterType,
    requesterType === "system" ? null : String(row.owner_user_id || ""),
    collaborationId ? "collaboration" : null,
    collaborationId,
    loadTicketTypes()?.version ?? 1,
    ticketId,
  );
}

/**
 * 启动对账（幂等；默认只跑一次，以 app_state 标记）：
 * 为历史工单行补票型分类——换表迁移（work_items → tickets）带来的旧行由此一次性补齐。
 */
export function reconcileTickets(options: { conn?: SqliteConn; force?: boolean } = {}): { classified: number } {
  const conn = options.conn || getConn();
  if (!options.force && conn.prepare("SELECT value FROM app_state WHERE key=?").get(CLASSIFIED_FLAG)) {
    return { classified: 0 };
  }
  const rows = conn.prepare("SELECT id FROM tickets").all() as Row[];
  for (const row of rows) ensureTicketForWorkItem(String(row.id), { conn });
  conn.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, 'done')").run(CLASSIFIED_FLAG);
  return { classified: rows.length };
}
