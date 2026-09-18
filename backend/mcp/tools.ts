/**
 * Dify 工具节点的实现。Codex 经 MCP 调用这些只读工具。
 * 发信 / confirm-stage / ingest / 企微 不在这里 —— 那些是 Gateway。
 */
import { claw, starry } from "../src/adapters/clients.js";
import { getConversation } from "../src/adapters/starry.js";
import { getConn } from "../src/db.js";
import { rejectDiscoveryHarnessTool } from "../src/gateway/discovery-harness.js";
import { label } from "../src/stages.js";
import type { Json } from "../src/types.js";

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Json;
  annotations?: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
};

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const WRITE_NAMES = new Set([
  "send_mail",
  "send_conversation",
  "confirm_stage",
  "starry_stage",
  "ingest",
  "ingest_mediacrawler",
  "wecom_send",
  "create_creator",
  "patch_status",
]);

export function isForbiddenWriteTool(name: string): boolean {
  return WRITE_NAMES.has(name) || name.includes("send") || name.includes("ingest") || name.includes("confirm_stage");
}

export const STARRY_TOOLS: McpToolDef[] = [
  {
    name: "stage_options",
    description: "Read Starry 16 official stage codes. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "dictionary_options",
    description: "Read Starry dictionary options (brand mailboxes / stages). Read-only.",
    inputSchema: {
      type: "object",
      properties: { parentKey: { type: "string" } },
      required: ["parentKey"],
    },
  },
  {
    name: "get_conversation",
    description: "Read a Starry conversation snapshot (handle, stage). Does not send mail.",
    inputSchema: {
      type: "object",
      properties: { conversation_id: { type: "string" } },
      required: ["conversation_id"],
    },
  },
  {
    name: "get_collaboration",
    description: "Read one collaboration by handle or id. Read-only. Does not write stage.",
    inputSchema: {
      type: "object",
      properties: { handle: { type: "string" }, id: { type: "string" } },
    },
  },
  {
    name: "get_unbound_inbound",
    description: "Read one unbound inbound email. Read-only. Does not bind or ingest.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_collaborations",
    description: "List lightweight collaboration and stage summaries from the local Starry cache. Read-only.",
    inputSchema: { type: "object", properties: { status: { type: "string" } } },
  },
  {
    name: "deal_memory",
    description: "Read negotiation facts and prior draft amounts for one collaboration. Read-only.",
    inputSchema: {
      type: "object",
      properties: { collaboration_id: { type: "string" }, handle: { type: "string" } },
    },
  },
  ...["logistics", "publication", "settlement", "attribution"].map((kind): McpToolDef => ({
    name: `${kind}_summary`,
    description: `Read a lightweight ${kind} summary from local collaboration/demo data. Missing external data is identified explicitly.`,
    inputSchema: {
      type: "object",
      properties: { collaboration_id: { type: "string" }, handle: { type: "string" } },
    },
  })),
];

export const CLAW_TOOLS: McpToolDef[] = [
  {
    name: "health",
    description: "Claw health. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_creators",
    description: "Read paginated normalized creators. Local test fallback for remote MediaCrawler MCP.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string" },
        page: { type: "number" },
        page_size: { type: "number" },
        task_id: { type: "string" },
      },
    },
  },
  {
    name: "list_creators",
    description: "List KOL creators from Claw. Read-only. Never ingest.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_creator",
    description: "Get one Claw creator by id or handle. Read-only.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "outreach_script",
    description: "Read Claw outreach script for a creator. Read-only.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "analysis_creators",
    description: "Read-only creator analysis.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "search_knowledge",
    description: "Search Host knowledge titles (read-only variables helper).",
    inputSchema: {
      type: "object",
      properties: { tag: { type: "string" } },
      required: ["tag"],
    },
  },
  {
    name: "list_overdue",
    description: "Read overdue collaborations for T8. Read-only. Does not write stage.",
    inputSchema: { type: "object", properties: {} },
  },
];

export function callStarryTool(name: string, args: Json = {}): Json {
  if (isForbiddenWriteTool(name)) {
    throw new Error(`MCP starry 拒绝写工具 ${name}。发信/改阶段只走 Gateway。`);
  }
  if (name === "stage_options") return { options: starry.cooperationStageOptions() };
  if (name === "dictionary_options") return { options: starry.dictionaryOptions(String(args.parentKey || "")) };
  if (name === "get_conversation") {
    return getConversation(String(args.conversation_id || "")) || { found: false };
  }
  if (name === "get_collaboration") {
    const db = getConn();
    let row: Record<string, unknown> | undefined;
    if (args.id) {
      row = db.prepare("SELECT * FROM collaborations WHERE id = ?").get(args.id) as Record<string, unknown> | undefined;
    }
    if (!row && args.handle) {
      row = db
        .prepare("SELECT * FROM collaborations WHERE handle = ? OR display_name = ?")
        .get(args.handle, args.handle) as Record<string, unknown> | undefined;
    }
    if (!row) return { found: false };
    return {
      found: true,
      id: row.id,
      handle: row.handle,
      display_name: row.display_name,
      brand: row.brand,
      email: row.email,
      mailbox_from: row.mailbox_from,
      stage_code: row.stage_code,
      platform: row.platform,
      followers: row.followers,
      notes: row.notes,
      conversation_id: row.conversation_id,
      lifecycle_id: row.lifecycle_id,
      recipient_name: row.recipient_name,
      phone: row.phone,
      address_line: row.address_line,
      country: row.country,
      postal: row.postal,
      sku: row.sku,
      qty: row.qty,
    };
  }
  if (name === "get_unbound_inbound") {
    const row = getConn().prepare("SELECT * FROM inbound WHERE bound = 0 LIMIT 1").get() as Record<string, unknown> | undefined;
    if (!row) return { found: false };
    return {
      found: true,
      bound: false,
      from: row.from_addr,
      from_addr: row.from_addr,
      subject: row.subject,
      snippet: row.snippet,
      unbound_path: true,
    };
  }
  if (name === "list_collaborations") {
    const rows = getConn().prepare(
      `SELECT id,handle,display_name,brand,platform,stage_code,days_in_stage,overdue,notes
         FROM collaborations ORDER BY overdue DESC, days_in_stage DESC`,
    ).all() as Record<string, unknown>[];
    return { items: rows, source: "local_starry_cache", external_data: false };
  }
  if (name === "deal_memory") {
    const row = collaborationForSummary(args);
    if (!row) return { found: false, source: "local_db" };
    const drafts = getConn().prepare(
      `SELECT skill,amount_usd,currency,status,created_at
         FROM drafts WHERE collaboration_id=? ORDER BY id DESC LIMIT 10`,
    ).all(row.id) as Record<string, unknown>[];
    return {
      found: true,
      collaboration_id: row.id,
      handle: row.handle,
      notes: row.notes || "",
      prior_drafts: drafts,
      source: "local_db",
      external_data: false,
      notice: "No external deal-memory service was queried.",
    };
  }
  if (["logistics_summary", "publication_summary", "settlement_summary", "attribution_summary"].includes(name)) {
    const row = collaborationForSummary(args);
    if (!row) return { found: false, source: "local_db", external_data: false };
    const kind = name.replace("_summary", "");
    return {
      found: true,
      kind,
      collaboration_id: row.id,
      handle: row.handle,
      stage_code: row.stage_code,
      stage_label: label(String(row.stage_code)),
      days_in_stage: row.days_in_stage,
      overdue: Boolean(row.overdue),
      notes: row.notes || "",
      source: "local_db",
      external_data: false,
      notice: `No external ${kind} system is configured; only local/demo facts are returned.`,
    };
  }
  throw new Error(`unknown starry tool: ${name}`);
}

function collaborationForSummary(args: Json): Record<string, unknown> | undefined {
  if (args.collaboration_id) {
    return getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(args.collaboration_id) as
      | Record<string, unknown>
      | undefined;
  }
  if (args.handle) {
    return getConn().prepare("SELECT * FROM collaborations WHERE handle=? OR display_name=?")
      .get(args.handle, args.handle) as Record<string, unknown> | undefined;
  }
  return getConn().prepare("SELECT * FROM collaborations ORDER BY overdue DESC, days_in_stage DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;
}

export function callClawTool(name: string, args: Json = {}): Json {
  if (isForbiddenWriteTool(name)) {
    throw new Error(`MCP claw 拒绝写工具 ${name}。ingest / 写状态只走 Host/Gateway。`);
  }
  if (name === "health") return claw.health();
  if (name === "get_creators") {
    const rows = claw.listCreators();
    const filtered = args.platform ? rows.filter((row) => row.platform === args.platform) : rows;
    const page = Math.max(1, Number(args.page || 1));
    const size = Math.max(1, Number(args.page_size || 100));
    return { creators: filtered.slice((page - 1) * size, page * size), has_more: page * size < filtered.length };
  }
  if (name === "list_creators") return { creators: claw.listCreators() };
  if (name === "get_creator") return claw.getCreator(String(args.id || "")) || { found: false };
  if (name === "outreach_script") return claw.outreachScript(String(args.id || "cr_outdoor"));
  if (name === "analysis_creators") return claw.analysisCreators(args.id ? String(args.id) : null);
  if (name === "search_knowledge") {
    const tag = String(args.tag || "");
    const row = getConn().prepare(
      "SELECT title FROM knowledge WHERE status='published' AND tags LIKE ? LIMIT 1",
    ).get(`%${tag}%`) as { title: string } | undefined;
    return { title: row?.title || tag, tag };
  }
  if (name === "list_overdue") {
    const rows = getConn()
      .prepare("SELECT handle, stage_code, days_in_stage, brand FROM collaborations WHERE overdue = 1")
      .all() as { handle: string; stage_code: string; days_in_stage: number; brand: string }[];
    return {
      items: rows.map((r) => ({
        handle: r.handle,
        stage_code: r.stage_code,
        stage_label: label(r.stage_code),
        days: r.days_in_stage,
        brand: r.brand,
      })),
    };
  }
  throw new Error(`unknown claw tool: ${name}`);
}

export function callMcpTool(server: "starry" | "claw", name: string, args: Json = {}): Json {
  rejectDiscoveryHarnessTool(name);
  if (server === "starry") return callStarryTool(name, args);
  return callClawTool(name, args);
}
