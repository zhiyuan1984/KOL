/**
 * Codex app-server harness → 会话「处理过程」。
 * 过程条目只来自真实生命周期和 turn item（尤其是 reasoning summary），
 * 不再预写「理解任务 / 加载 Skill / …」五段空模板。
 * raw reasoning_text 永不进 UI，只展示 summary_text。
 */
import { redactSecrets } from "./auth.js";
import type { Json } from "../types.js";

export type WorkerPhase =
  | "preparing"
  | "skill_ready"
  | "reading_data"
  | "generating"
  | "formatting"
  | "validating";

export type WorkerTraceKind = "host" | "reasoning" | "result";

export const REMOTE_MCP_TITLE = "远程MCP调用";
export const REASONING_STREAM_LIMIT = 4000;

export type WorkerTraceItem = {
  id: string;
  label: string;
  status: "running" | "done" | "failed" | "interrupted";
  kind?: WorkerTraceKind;
  streaming?: boolean;
};

export type WorkerOperation = {
  id?: string;
  name: string;
  status: string;
  server?: string;
  label?: string;
};

export type WorkerProgress = {
  phase: WorkerPhase;
  summary?: string;
  delta?: string;
  operation?: WorkerOperation;
  trace?: WorkerTraceItem;
};

const HOST_PHASE_TRACE: Partial<Record<WorkerPhase, { id: string; label: string }>> = {
  preparing: { id: "host:preparing", label: "准备任务" },
  skill_ready: { id: "host:skill_ready", label: "加载任务规则" },
  generating: { id: "host:generating", label: "正在分析…" },
  formatting: { id: "host:formatting", label: "整理结果" },
  validating: { id: "host:validating", label: "校验输出" },
};

export function hostTraceForPhase(phase: WorkerPhase, status: WorkerTraceItem["status"] = "running"): WorkerTraceItem | null {
  const spec = HOST_PHASE_TRACE[phase];
  if (!spec) return null;
  return { ...spec, status, kind: phase === "formatting" || phase === "validating" ? "result" : "host" };
}

export function statusTextForProgress(phase: WorkerPhase, summary?: string): string {
  if (summary) return summary.length > 80 ? `${summary.slice(0, 77)}…` : summary;
  const text: Partial<Record<WorkerPhase, string>> = {
    preparing: "正在准备任务…",
    skill_ready: "任务规则已加载…",
    reading_data: "正在读取业务数据…",
    generating: "正在分析…",
    formatting: "正在整理结果…",
    validating: "正在校验输出…",
  };
  return text[phase] || "正在处理…";
}

function asItem(params: Json): Json {
  const item = params.item;
  return item && typeof item === "object" ? item as Json : params;
}

function itemType(item: Json): string {
  return String(item.type || item.itemType || "");
}

function itemIdOf(item: Json, params: Json): string {
  return String(item.id || params.itemId || params.item_id || "").slice(0, 80);
}

function safeText(value: string, limit = REASONING_STREAM_LIMIT): string {
  return redactSecrets(value).slice(0, limit);
}

export function reasoningSummary(item: Json): string {
  if (!Array.isArray(item.summary)) return "";
  return safeText(
    (item.summary as Json[])
      .map((part) => String(part?.text || ""))
      .filter(Boolean)
      .join("\n"),
  );
}

function hasReasoningSummaryPayload(params: Json): boolean {
  const raw = params.delta;
  if (raw && typeof raw === "object") {
    const delta = raw as Json;
    if (typeof delta.summary_text === "string" && delta.summary_text) return true;
    if (Array.isArray(delta.summary)) return true;
  }
  return false;
}

function reasoningDelta(method: string | undefined, params: Json): string {
  if (!method || (!/reasoning/i.test(method) && method !== "item/delta")) return "";
  // Raw reasoning_text deltas never enter the UI — summary_text / summary only.
  if (/textDelta/i.test(method) && !/summary/i.test(method)) return "";
  const raw = params.delta;
  if (raw && typeof raw === "object") {
    const delta = raw as Json;
    if (typeof delta.summary_text === "string") return safeText(String(delta.summary_text));
    if (Array.isArray(delta.summary)) return reasoningSummary({ summary: delta.summary });
    if (typeof delta.text === "string" && /summary/i.test(method)) return safeText(delta.text);
    return "";
  }
  if (typeof raw === "string" && /summary/i.test(method)) return safeText(raw);
  if (typeof params.text === "string" && /summary/i.test(method)) return safeText(String(params.text));
  return "";
}

export function agentMessageDelta(method: string | undefined, params: Json): string {
  if (method !== "item/agentMessage/delta") {
    if (method !== "item/delta") return "";
    const type = itemType(asItem(params));
    if (type && type !== "agentMessage") return "";
  }
  const item = asItem(params);
  const raw = params.delta ?? item.delta ?? item.text;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") return String((raw as Json).text || "");
  return "";
}

function operationStatus(method: string | undefined, item: Json): string {
  if (method === "item/completed") return String(item.status || "completed");
  return "running";
}

export function qualifiedMcpName(operation: { name?: string; server?: string; tool?: string }): string {
  const tool = String(operation.tool || operation.name || "").replace(/[^A-Za-z0-9_.:/-]/g, "").slice(0, 120);
  const server = String(operation.server || "").replace(/[^A-Za-z0-9_.:/-]/g, "").slice(0, 50);
  if (tool.includes(".")) return tool;
  return server ? `${server}.${tool}` : tool;
}

export function mcpCallDisplay(operation: { name?: string; label?: string; server?: string }): string {
  const name = qualifiedMcpName(operation);
  const human = String(operation.label || "").trim();
  if (human && name && human !== name) return `${human} · ${name}`;
  return human || name || "远程调用";
}

function mcpOperation(item: Json, method: string | undefined, params: Json): WorkerProgress["operation"] {
  const tool = String(item.tool || item.name || "read_data").replace(/[^A-Za-z0-9_.:/-]/g, "").slice(0, 100);
  const server = item.server ? String(item.server).slice(0, 50) : "";
  const name = qualifiedMcpName({ name: tool, server });
  const id = itemIdOf(item, params) || name;
  return {
    id,
    name,
    status: operationStatus(method, item),
    label: tool,
    ...(server ? { server } : {}),
  };
}

export type HarnessMemory = {
  reasoningById: Map<string, string>;
};

export function emptyHarnessMemory(): HarnessMemory {
  return { reasoningById: new Map() };
}

export function progressFromHarness(
  method: string | undefined,
  params: Json,
  memory: HarnessMemory,
): WorkerProgress | null {
  const item = asItem(params);
  const type = itemType(item);
  const methodStr = String(method || "");
  const startedOrDone = method === "item/started" || method === "item/completed";
  const mcpLike = type === "mcpToolCall" || /mcpToolCall/i.test(methodStr);
  if (mcpLike) {
    return { phase: "reading_data", operation: mcpOperation(item, method, params) };
  }
  if (type === "webSearch" || type === "web_search") {
    const id = itemIdOf(item, params) || "web_search";
    return {
      phase: "reading_data",
      operation: {
        id,
        name: "web_search",
        label: "检索公开资料",
        status: operationStatus(method, item),
      },
    };
  }

  const rawId = itemIdOf(item, params);
  const knownReasoning = Boolean(rawId && memory.reasoningById.has(rawId));
  const reasoningLike = type === "reasoning"
    || /reasoning/i.test(methodStr)
    || (method === "item/delta" && (knownReasoning || hasReasoningSummaryPayload(params)));
  if (reasoningLike) {
    const id = rawId || "thinking";
    const summary = reasoningSummary(item);
    const delta = reasoningDelta(method, params);
    let text = memory.reasoningById.get(id) || "";
    if (summary) text = summary;
    else if (delta) text = safeText(text + delta);
    memory.reasoningById.set(id, text);
    const done = methodStr.includes("completed");
    return {
      phase: "generating",
      ...(text ? { summary: text } : {}),
      trace: {
        id: `reasoning:${id}`,
        label: text || "正在分析…",
        status: done ? "done" : "running",
        kind: "reasoning",
        streaming: !done,
      },
    };
  }

  if (type === "agentMessage" && startedOrDone) {
    return {
      phase: method === "item/completed" ? "formatting" : "generating",
      trace: {
        id: "host:formatting",
        label: "整理结果",
        status: method === "item/completed" ? "done" : "running",
        kind: "result",
      },
    };
  }

  return null;
}

/** Host-backed reads replace Codex ops that failed under `approvalPolicy: never`. */
export function preferHostOperations(live: Json[], host: Json[]): Json[] {
  if (!host.length) return live;
  if (!live.length) return host;
  const byName = new Map<string, Json>();
  for (const row of live) {
    const name = String(row.name || "");
    if (name) byName.set(name, row);
  }
  for (const row of host) {
    const name = String(row.name || "");
    if (!name) continue;
    const prev = byName.get(name);
    if (!prev || String(row.status) === "done" || String(prev.status) !== "done") {
      byName.set(name, prev ? { ...prev, ...row } : row);
    }
  }
  const seen = new Set<string>();
  const merged: Json[] = [];
  for (const row of live) {
    const name = String(row.name || "");
    merged.push(name && byName.has(name) ? byName.get(name)! : row);
    if (name) seen.add(name);
  }
  for (const row of host) {
    const name = String(row.name || "");
    if (name && !seen.has(name)) merged.push(row);
  }
  return merged;
}

export function upsertOperationItem(
  items: { id: string; name: string; label: string; status: string }[],
  next: WorkerOperation,
): { id: string; name: string; label: string; status: string }[] {
  const name = qualifiedMcpName(next);
  const id = String(next.id || name);
  const row = {
    id,
    name,
    label: String(next.label || ""),
    status: String(next.status || "running"),
  };
  const index = items.findIndex((item) => item.id === id || item.name === name);
  if (index >= 0) {
    const copy = items.slice();
    copy[index] = { ...items[index], ...row };
    return copy;
  }
  return [...items, row];
}

export function upsertProcessItem(items: WorkerTraceItem[], next: WorkerTraceItem): WorkerTraceItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    const merged = { ...items[index], ...next };
    if (!next.label && items[index].label) merged.label = items[index].label;
    const copy = items.slice();
    copy[index] = merged;
    return copy;
  }
  return [...items, next];
}

export function applyHostPhase(items: WorkerTraceItem[], phase: WorkerPhase): WorkerTraceItem[] {
  const trace = hostTraceForPhase(phase, phase === "validating" || phase === "skill_ready" ? "done" : "running");
  if (!trace) return items;
  let next = items;
  if (phase !== "preparing") {
    next = next.map((item) =>
      item.kind === "host" && item.status === "running" && item.id !== trace.id
        ? { ...item, status: "done" }
        : item,
    );
  }
  if (phase === "generating" && next.some((item) => item.kind === "reasoning")) return next;
  return upsertProcessItem(next, trace);
}

export function applyProgress(items: WorkerTraceItem[], progress: WorkerProgress): WorkerTraceItem[] {
  let next = items;
  if (progress.trace) {
    if (progress.trace.kind === "reasoning") {
      next = next.filter((item) => item.id !== "host:generating");
    } else if (progress.trace.id === "host:generating" && next.some((item) => item.kind === "reasoning")) {
      return next;
    }
    next = upsertProcessItem(next, progress.trace);
  } else if (progress.phase !== "reading_data") {
    next = applyHostPhase(next, progress.phase);
  }
  return next;
}

export function finishProcessItems(items: WorkerTraceItem[], failed: boolean): WorkerTraceItem[] {
  if (!items.length) {
    return failed
      ? [{ id: "host:preparing", label: "准备任务", status: "interrupted", kind: "host" }]
      : [{ id: "host:validating", label: "校验输出", status: "done", kind: "result" }];
  }
  let marked = false;
  return items.map((item, index) => {
    if (!failed) return { ...item, status: "done", streaming: false };
    if (item.status === "running") {
      marked = true;
      return { ...item, status: "interrupted", streaming: false };
    }
    if (!marked && index === items.length - 1) {
      marked = true;
      return { ...item, status: "interrupted", streaming: false };
    }
    return { ...item, streaming: false };
  });
}

export function reasoningSummariesOf(items: WorkerTraceItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    if (item.kind !== "reasoning") continue;
    const label = item.label.trim();
    if (label && label !== "正在分析…" && !lines.includes(label)) lines.push(label);
  }
  return lines.slice(-12);
}
