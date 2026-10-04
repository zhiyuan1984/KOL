import { getConn } from "../db.js";
import { taskDefinitions } from "../tasks/registry.js";
import type { Row } from "../types.js";
import { ensureRuntimeSchema, listSkillConnectorBindings, listSkillToolBindings } from "./store.js";
import { DOCUMENT_TOOL, documentDependencies } from "./document-knowledge.js";

/** 技能声明的 MCP 工具：`<connector>.<tool>`，无前缀的条目照原样保留连接器为空。 */
export type DeclaredTool = { connector_id: string; tool_name: string; declared_as: string };

/**
 * 解析 SKILL.md 的 mcp 声明。声明是厂商文本，不是平台契约：缺前缀、带空白或重复都要
 * 容错成可读的一行，只有整条空白或没有工具名时才丢弃（挂不上任何东西的行不该变成挂载项）。
 * 输出按 declared_as 去重并保持输入顺序，读模型与写路由才有一致的遍历次序。
 */
export function parseDeclaredMcp(entries: readonly string[]): DeclaredTool[] {
  const seen = new Set<string>();
  const parsed: DeclaredTool[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const declared = entry.trim();
    if (!declared) continue;
    const separator = declared.indexOf(".");
    const connectorId = separator > 0 ? declared.slice(0, separator).trim() : "";
    const toolName = (separator > 0 ? declared.slice(separator + 1) : declared).trim();
    if (!toolName || seen.has(declared)) continue;
    seen.add(declared);
    parsed.push({ connector_id: connectorId, tool_name: toolName, declared_as: declared });
  }
  return parsed;
}

export type ToolMountState = "mounted" | "available" | "blocked_by_policy" | "unregistered" | "unknown_connector";

export type CoverageTool = {
  connector_id: string;
  connector_label?: string;
  tool_name: string;
  declared_as: string;
  state: ToolMountState;
  policy_risk?: "L1" | "L2" | "L3";
  policy_enabled?: boolean;
  connector_enabled?: boolean;
  connector_status?: string;
};

function isPolicyEnabled(value: number | boolean | undefined): boolean {
  return value === true || Number(value) === 1;
}

/**
 * 单个声明工具的挂载状态。判定顺序即优先级：已挂载优先于其它；连接器不存在时
 * 「未登记策略」无从判断，未启用策略与未登记策略是两回事（前者等管理员放行，后者缺目录行）。
 */
export function toolMountState(input: {
  declared: DeclaredTool;
  policy?: { enabled: number | boolean; risk?: string } | null;
  policyConnectorExists: boolean;
  bound: boolean;
}): ToolMountState {
  if (input.bound) return "mounted";
  if (!input.policyConnectorExists) return "unknown_connector";
  if (!input.policy) return "unregistered";
  if (!isPolicyEnabled(input.policy.enabled)) return "blocked_by_policy";
  return "available";
}

export type Implementation = "live" | "defined";

/** 已上线＝Agent 绑定且阶段 published；其余都是「已定义但不可执行」。 */
export function skillImplementation(input: {
  agentBound: boolean;
  stage: string | null | undefined;
}): Implementation {
  return input.agentBound && input.stage === "published" ? "live" : "defined";
}

export type CoverageConnector = {
  id: string;
  label: string;
  enabled: boolean;
  status: string;
  /** 已启用策略数：连接器目录里当前可被技能挂载的工具数 */
  approved_tool_count: number;
};

export type CoverageSkill = {
  skill_id: string;
  label: string;
  stage: string | null;
  published_version: number | null;
  agents: string[];
  agent_bound: boolean;
  implementation: Implementation;
  declared_tools: number;
  mounted_tools: number;
  pending_tools: number;
  tools: CoverageTool[];
};

export type SkillCoverage = {
  summary: {
    skills: number;
    live: number;
    defined: number;
    declared_tools: number;
    mounted_tools: number;
    pending_tools: number;
  };
  connectors: CoverageConnector[];
  skills: CoverageSkill[];
};

function keyOf(...parts: string[]): string {
  return parts.join("\u0000");
}

function rows(sql: string, ...params: unknown[]): Row[] {
  return getConn().prepare(sql).all(...params) as Row[];
}

/**
 * 技能声明的工具 × 运行目录的只读聚合：读模型只描述「声明了什么、够不够得着」，
 * 不代替挂载动作（写入口是 mount-declared）。缺配置的领域一律省略字段，不造假值。
 */
export function skillCoverage(options: { connectorId?: string; root?: string } = {}): SkillCoverage {
  ensureRuntimeSchema();
  const connectorId = options.connectorId?.trim() || undefined;

  const directory = new Map<string, { id: string; label: string; enabled: boolean; status: string }>();
  for (const row of rows("SELECT id,label,enabled,status FROM connectors")) {
    const id = String(row.id);
    directory.set(id, {
      id,
      label: String(row.label ?? id),
      enabled: Number(row.enabled) === 1,
      status: String(row.status ?? ""),
    });
  }

  const stages = new Map<string, string>();
  for (const row of rows("SELECT skill_id,stage FROM skill_lifecycle")) stages.set(String(row.skill_id), String(row.stage));

  const publishedVersions = new Map<string, number>();
  for (const row of rows(
    "SELECT skill_id,MAX(version) AS version FROM skill_versions WHERE status='published' GROUP BY skill_id",
  )) {
    if (row.version !== null && row.version !== undefined) publishedVersions.set(String(row.skill_id), Number(row.version));
  }

  const boundAgents = new Map<string, string[]>();
  for (const row of rows("SELECT agent_id,skill_id FROM runtime_agent_skills WHERE enabled=1 ORDER BY agent_id")) {
    const skillId = String(row.skill_id);
    boundAgents.set(skillId, [...(boundAgents.get(skillId) || []), String(row.agent_id)]);
  }

  const policies = new Map<string, { enabled: number; risk: "L1" | "L2" | "L3" }>();
  const approvedCounts = new Map<string, number>();
  for (const row of rows("SELECT connector_id,tool_name,enabled,risk FROM runtime_tool_policies")) {
    const connector = String(row.connector_id);
    policies.set(keyOf(connector, String(row.tool_name)), {
      enabled: Number(row.enabled),
      risk: String(row.risk) as "L1" | "L2" | "L3",
    });
    if (Number(row.enabled) === 1) approvedCounts.set(connector, (approvedCounts.get(connector) || 0) + 1);
  }

  const connectorBindings = new Set(
    listSkillConnectorBindings()
      .filter((row) => Number(row.enabled) === 1)
      .map((row) => keyOf(String(row.skill_id), String(row.connector_id))),
  );
  const toolBindings = new Set(
    listSkillToolBindings()
      .filter((row) => Number(row.enabled) === 1)
      .map((row) => keyOf(String(row.skill_id), String(row.connector_id), String(row.tool_name))),
  );

  const skills: CoverageSkill[] = [];
  const referenced = new Set<string>();
  for (const definition of taskDefinitions(options.root)) {
    const tools: CoverageTool[] = [];
    for (const declared of parseDeclaredMcp(definition.mcp)) {
      if (connectorId && declared.connector_id !== connectorId) continue;
      if (declared.declared_as === DOCUMENT_TOOL) {
        tools.push({ ...declared, connector_label: "知识文档", policy_risk: "L1", policy_enabled: true,
          state: documentDependencies(definition.id).length ? "mounted" : "available" });
        continue;
      }
      const connector = directory.get(declared.connector_id);
      const policy = policies.get(keyOf(declared.connector_id, declared.tool_name));
      // 「已挂载」对齐启用闸门：父连接器绑定与工具绑定都得启用，否则上游仍不可用。
      const bound = connectorBindings.has(keyOf(definition.id, declared.connector_id))
        && toolBindings.has(keyOf(definition.id, declared.connector_id, declared.tool_name));
      const state = toolMountState({
        declared,
        policy: policy ?? null,
        policyConnectorExists: Boolean(connector),
        bound,
      });
      if (connector) referenced.add(declared.connector_id);
      tools.push({
        connector_id: declared.connector_id,
        ...(connector ? { connector_label: connector.label } : {}),
        tool_name: declared.tool_name,
        declared_as: declared.declared_as,
        state,
        ...(policy ? { policy_risk: policy.risk, policy_enabled: policy.enabled === 1 } : {}),
        ...(connector ? { connector_enabled: connector.enabled, connector_status: connector.status } : {}),
      });
    }
    if (connectorId && !tools.length) continue;
    const agents = boundAgents.get(definition.id) || [];
    const stage = stages.get(definition.id) ?? null;
    const mounted = tools.filter((tool) => tool.state === "mounted").length;
    skills.push({
      skill_id: definition.id,
      label: definition.employee_summary || definition.title || definition.id,
      stage,
      published_version: publishedVersions.get(definition.id) ?? null,
      agents,
      agent_bound: agents.length > 0,
      implementation: skillImplementation({ agentBound: agents.length > 0, stage }),
      declared_tools: tools.length,
      mounted_tools: mounted,
      pending_tools: tools.length - mounted,
      tools,
    });
  }

  const connectors: CoverageConnector[] = [...referenced]
    .map((id) => directory.get(id))
    .filter((connector): connector is { id: string; label: string; enabled: boolean; status: string } => Boolean(connector))
    .map((connector) => ({ ...connector, approved_tool_count: approvedCounts.get(connector.id) || 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const sum = (pick: (skill: CoverageSkill) => number) => skills.reduce((total, skill) => total + pick(skill), 0);
  return {
    summary: {
      skills: skills.length,
      live: skills.filter((skill) => skill.implementation === "live").length,
      defined: skills.filter((skill) => skill.implementation === "defined").length,
      declared_tools: sum((skill) => skill.declared_tools),
      mounted_tools: sum((skill) => skill.mounted_tools),
      pending_tools: sum((skill) => skill.pending_tools),
    },
    connectors,
    skills,
  };
}
