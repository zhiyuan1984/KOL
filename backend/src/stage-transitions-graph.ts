/**
 * Host product gate for confirm_stage (ADR-027).
 * Loads `config/stage-transitions.json`. Starry adjacency is not a product edge.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpFail } from "./host/errors.js";
import { normalizeStage } from "./stages.js";
import { codexMode } from "./config.js";

export type StageActor = "human" | "auto";

export type StageTransitionKind =
  | "forward_adjacent"
  | "forward_skip"
  | "rollback"
  | "enter_exception"
  | "leave_exception"
  | "host_terminal"
  | "unknown";

export type StageGraphDecision = {
  from: string;
  to: string;
  actor: StageActor;
  kind: StageTransitionKind;
  allowed: boolean;
  forbid: boolean;
  require_reason: boolean;
  require_approval: boolean;
  flags: string[];
  code: "ok" | "forbidden_edge" | "unknown_node" | "graph_unavailable" | "same_stage";
  message: string;
};

type StageGraphFile = {
  version?: number;
  nodes?: { id: string; kind?: string }[];
  happy_path?: [string, string][];
  human_policy?: Record<string, string[]>;
  auto_policy?: Record<string, string[]>;
  require_approval_on_enter?: string[];
  exception_kinds_host_only?: {
    bypass_returnable?: string[];
    terminal?: string[];
    not_a_product_node?: string[];
  };
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let cached: { file: string; mtime: number; graph: StageGraphFile } | null = null;

export function stageTransitionsGraphPath(): string {
  return process.env.STAGE_TRANSITIONS_PATH
    || path.join(repoRoot, "config", "stage-transitions.json");
}

export function resetStageTransitionGraphCache(): void {
  cached = null;
}

function graphUnavailable(detail: string): HttpFail {
  return new HttpFail(503, {
    code: "stage_graph_unavailable",
    message: `产品阶段图不可用，Host 已关闭阶段写入（fail-closed）：${detail}`,
    path: stageTransitionsGraphPath(),
  });
}

export function loadStageTransitionGraph(options: { refresh?: boolean } = {}): StageGraphFile {
  const file = stageTransitionsGraphPath();
  if (!fs.existsSync(file)) {
    throw graphUnavailable(`找不到 ${file}`);
  }
  const mtime = fs.statSync(file).mtimeMs;
  if (!options.refresh && cached && cached.file === file && cached.mtime === mtime) {
    return cached.graph;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw graphUnavailable(`无法解析 JSON（${why}）`);
  }
  const graph = raw && typeof raw === "object" ? raw as StageGraphFile : null;
  if (!graph?.nodes?.length || !Array.isArray(graph.happy_path) || !graph.happy_path.length) {
    throw graphUnavailable("阶段图缺少 nodes / happy_path");
  }
  cached = { file, mtime, graph };
  return graph;
}

function mainOrder(graph: StageGraphFile): string[] {
  const fromHappy = graph.happy_path!.map(([from]) => from);
  const last = graph.happy_path![graph.happy_path!.length - 1]?.[1];
  if (last && !fromHappy.includes(last)) fromHappy.push(last);
  return fromHappy;
}

function exceptionSets(graph: StageGraphFile) {
  const kinds = graph.exception_kinds_host_only || {};
  return {
    returnable: new Set(kinds.bypass_returnable || ["PAUSED", "DISPUTED"]),
    terminal: new Set(kinds.terminal || ["LOST", "REJECTED", "CANCELLED"]),
    hostOnly: new Set(kinds.not_a_product_node || ["COMPLETED"]),
  };
}

function productKind(
  graph: StageGraphFile,
  code: string,
): "main" | "exception" | "host_terminal" | "unknown" {
  const normalized = normalizeStage(code);
  if (graph.nodes!.some((node) => node.id === normalized && node.kind === "main")) return "main";
  if (normalized === "exception") return "exception";
  const { returnable, terminal, hostOnly } = exceptionSets(graph);
  if (returnable.has(normalized) || terminal.has(normalized)) return "exception";
  if (hostOnly.has(normalized)) return "host_terminal";
  return "unknown";
}

export function classifyStageTransition(from: string, to: string): StageTransitionKind {
  const graph = loadStageTransitionGraph();
  const start = normalizeStage(from);
  const end = normalizeStage(to);
  const fromKind = productKind(graph, start);
  const toKind = productKind(graph, end);
  if (fromKind === "unknown" || toKind === "unknown") return "unknown";
  if (fromKind === "host_terminal") return "unknown";
  if (fromKind === "main" && toKind === "host_terminal") {
    return start === "SETTLING" && end === "COMPLETED" ? "host_terminal" : "unknown";
  }
  if (fromKind === "main" && toKind === "exception") return "enter_exception";
  if (fromKind === "exception" && toKind === "main") return "leave_exception";
  if (fromKind === "main" && toKind === "main") {
    const order = mainOrder(graph);
    const fromIdx = order.indexOf(start);
    const toIdx = order.indexOf(end);
    if (fromIdx < 0 || toIdx < 0) return "unknown";
    if (toIdx === fromIdx + 1) return "forward_adjacent";
    if (toIdx > fromIdx + 1) return "forward_skip";
    if (toIdx < fromIdx) return "rollback";
  }
  return "unknown";
}

function policyFlags(graph: StageGraphFile, actor: StageActor, kind: StageTransitionKind, from: string): string[] {
  if (kind === "host_terminal") return actor === "human" ? ["allow_human"] : ["forbid"];
  if (kind === "unknown") return ["forbid"];
  const policy = actor === "human" ? graph.human_policy || {} : graph.auto_policy || {};
  if (kind === "leave_exception" && actor === "auto") {
    const { returnable, terminal } = exceptionSets(graph);
    const host = normalizeStage(from);
    if (terminal.has(host)) return policy.leave_exception_terminal || ["forbid"];
    if (returnable.has(host)) return policy.leave_exception_returnable || ["allow_auto"];
    return ["forbid"];
  }
  return policy[kind] || ["forbid"];
}

function decisionMessage(decision: Omit<StageGraphDecision, "message">): string {
  if (decision.code === "same_stage") return "目标阶段与当前相同";
  if (decision.code === "unknown_node") return "阶段图无法识别该节点，已拒绝写入";
  if (decision.actor === "auto") {
    return "自动写入只能走阶段图 allow_auto 边；跨段、回退或禁止边必须由人确认";
  }
  return "该转移被产品阶段图禁止（forbid）。人可以跨段、回退或进出异常，但不能离开终态异常。";
}

export function evaluateStageTransition(
  from: string,
  to: string,
  actor: StageActor,
): StageGraphDecision {
  const graph = loadStageTransitionGraph();
  const start = normalizeStage(from);
  const end = normalizeStage(to);
  if (start === end) {
    const same: StageGraphDecision = {
      from: start,
      to: end,
      actor,
      kind: "unknown",
      allowed: false,
      forbid: false,
      require_reason: false,
      require_approval: false,
      flags: [],
      code: "same_stage",
      message: "目标阶段与当前相同",
    };
    return same;
  }
  const fromKind = productKind(graph, start);
  const toKind = productKind(graph, end);
  const kind = classifyStageTransition(start, end);
  const flags = policyFlags(graph, actor, kind, start);
  const approvalTargets = new Set(graph.require_approval_on_enter || []);
  const requireApproval = approvalTargets.has(end);
  const forbid = flags.includes("forbid") || kind === "unknown" || fromKind === "unknown" || toKind === "unknown";
  const allowFlag = actor === "human" ? "allow_human" : "allow_auto";
  const allowed = !forbid && flags.includes(allowFlag);
  const code = fromKind === "unknown" || toKind === "unknown" || kind === "unknown"
    ? "unknown_node"
    : allowed ? "ok" : "forbidden_edge";
  const draft: Omit<StageGraphDecision, "message"> = {
    from: start,
    to: end,
    actor,
    kind,
    allowed,
    forbid,
    require_reason: flags.includes("require_reason"),
    require_approval: requireApproval,
    flags: requireApproval && !flags.includes("require_approval")
      ? [...flags, "require_approval"]
      : flags,
    code,
  };
  return { ...draft, message: decisionMessage(draft) };
}

/** Fail-closed product gate. Missing/invalid graph always throws. */
export function assertStageTransition(
  from: string,
  to: string,
  actor: StageActor,
  reason?: string | null,
): StageGraphDecision {
  let decision: StageGraphDecision;
  try {
    decision = evaluateStageTransition(from, to, actor);
  } catch (error) {
    if (error instanceof HttpFail) throw error;
    const why = error instanceof Error ? error.message : String(error);
    throw graphUnavailable(why);
  }
  if (decision.code === "same_stage") return decision;
  if (!decision.allowed) {
    throw new HttpFail(400, {
      code: decision.code,
      message: decision.message,
      current: decision.from,
      target: decision.to,
      actor,
      kind: decision.kind,
      flags: decision.flags,
      mode: codexMode(),
    });
  }
  if (decision.require_reason && !String(reason || "").trim()) {
    throw new HttpFail(400, {
      code: "stage_reason_required",
      message: "跨段、回退或进出异常必须填写原因。这是产品法，不是远程 hop 限制。",
      current: decision.from,
      target: decision.to,
      kind: decision.kind,
    });
  }
  return decision;
}
