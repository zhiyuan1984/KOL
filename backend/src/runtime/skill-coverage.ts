import { postgresDb } from "../postgres/access.js";
import { taskDefinitions } from "../tasks/registry.js";
import type { Row } from "../types.js";
import { ensureRuntimeSchema, listSkillConnectorBindings, listSkillToolBindings } from "./store.js";
import { DOCUMENT_TOOL, documentDependencies } from "./document-knowledge.js";
import { runtimeRequiresGate } from "../gateway/runtime-policy.js";
/** 技能声明的 MCP 工具：`<connector>.<tool>`，无前缀的条目照原样保留连接器为空。 */
export type DeclaredTool = {
  connector_id: string;
  tool_name: string;
  declared_as: string;
};
/**
 * 解析 SKILL.md 的 mcp 声明。声明是厂商文本，不是平台契约：缺前缀、带空白或重复都要
 * 容错成可读的一行，只有整条空白或没有工具名时才丢弃（挂不上任何东西的行不该变成挂载项）。
 * 输出按 declared_as 去重并保持输入顺序，读模型与写路由才有一致的遍历次序。
 */
export function parseDeclaredMcp(entries: readonly string[]): DeclaredTool[] {
  const seen = new Set<string>();
  const parsed: DeclaredTool[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string")
      continue;
    const declared = entry.trim();
    if (!declared)
      continue;
    const separator = declared.indexOf(".");
    const connectorId = separator > 0 ? declared.slice(0, separator).trim() : "";
    const toolName = (separator > 0 ? declared.slice(separator + 1) : declared).trim();
    if (!toolName || seen.has(declared))
      continue;
    seen.add(declared);
    parsed.push({ connector_id: connectorId, tool_name: toolName, declared_as: declared });
  }
  return parsed;
}

export type ToolMountState = "mounted" | "available" | "blocked_by_policy" | "unregistered" | "unknown_connector";

/**
 * 「所需工具」只对照已登记的工具目录：连接器存在，且该工具经 tools/list 发现并由管理员定了风险档
 * （runtime_tool_policies 有行）。文档问答由平台内置，视为已登记。没有代码白名单。
 */
export async function unregisteredDeclaredTools(mcp: readonly string[]): Promise<DeclaredTool[]> {
  (await ensureRuntimeSchema());
  const connectors = new Set((await rows("SELECT id FROM connectors")).map((row) => String(row.id)));
  const declared = parseDeclaredMcp(mcp);
  const unregistered = await Promise.all(declared.map(async (tool) => {
    if (tool.declared_as === DOCUMENT_TOOL)
      return false;
    if (!tool.connector_id || !connectors.has(tool.connector_id))
      return true;
    return !(await rows("SELECT 1 FROM runtime_tool_policies WHERE connector_id=$1 AND tool_name=$2", tool.connector_id, tool.tool_name)).length;
  }));
  return declared.filter((_, index) => unregistered[index]);
}
/** 已声明但没有挂上（技能→连接器、技能→工具两层都要启用）的工具；文档问答走知识绑定，不在此列。 */
export async function unmountedDeclaredTools(skillId: string, mcp: readonly string[]): Promise<DeclaredTool[]> {
  (await ensureRuntimeSchema());
  const connectors = new Set((await listSkillConnectorBindings()).filter((row) => row.skill_id === skillId && Number(row.enabled) === 1)
    .map((row) => String(row.connector_id)));
  const tools = new Set((await listSkillToolBindings()).filter((row) => row.skill_id === skillId && Number(row.enabled) === 1)
    .map((row) => keyOf(String(row.connector_id), String(row.tool_name))));
  return parseDeclaredMcp(mcp).filter((tool) => tool.declared_as !== DOCUMENT_TOOL
    && !(connectors.has(tool.connector_id) && tools.has(keyOf(tool.connector_id, tool.tool_name))));
}
/** 可供技能声明的工具：已登记目录 + 平台内置文档问答。 */
export async function registeredToolCatalog(): Promise<string[]> {
  (await ensureRuntimeSchema());
  const listed = (await rows("SELECT connector_id,tool_name FROM runtime_tool_policies ORDER BY connector_id,tool_name")).map((row) => `${row.connector_id}.${row.tool_name}`);
  return [...new Set([DOCUMENT_TOOL, ...listed])];
}
const RISK_ORDER = { L1: 1, L2: 2, L3: 3 } as const;
/**
 * 读取时派生、不存储：执行面＝已挂载的连接器（尚未挂载时退回声明的连接器）；
 * 风险档＝所需工具在目录里的最高档，受控动作下限（发送/改阶段/解密/导入/采集）一律 L3。
 * 未登记的工具没有档位，沿用按名称识别受控动作的兜底判断。
 */
export async function skillToolProfile(skillId: string, mcp: readonly string[]): Promise<{
  connectors: string[];
  connectors_mounted: boolean;
  risk: "L1" | "L2" | "L3" | null;
}> {
  (await ensureRuntimeSchema());
  const declared = parseDeclaredMcp(mcp).filter((tool) => tool.declared_as !== DOCUMENT_TOOL);
  const mounted = [...new Set((await listSkillConnectorBindings()).filter((row) => row.skill_id === skillId && Number(row.enabled) === 1).map((row) => String(row.connector_id)))];
  const declaredConnectors = [...new Set(declared.map((tool) => tool.connector_id).filter(Boolean))];
  let risk: "L1" | "L2" | "L3" | null = mcp.includes(DOCUMENT_TOOL) ? "L1" : null;
  for (const tool of declared) {
    const policy = (await rows("SELECT risk FROM runtime_tool_policies WHERE connector_id=$1 AND tool_name=$2", tool.connector_id, tool.tool_name))[0];
    const level: "L1" | "L2" | "L3" = runtimeRequiresGate(tool.tool_name)
      ? "L3"
      : policy ? (String(policy.risk) as "L1" | "L2" | "L3")
        : /send|decrypt|delete|upload|import|changeLifecycleStage/i.test(tool.tool_name) ? "L3" : "L1";
    if (!risk || RISK_ORDER[level] > RISK_ORDER[risk])
      risk = level;
  }
  return { connectors: mounted.length ? mounted : declaredConnectors, connectors_mounted: mounted.length > 0, risk };
}

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
  policy?: {
    enabled: number | boolean;
    risk?: string;
  } | null;
  policyConnectorExists: boolean;
  bound: boolean;
}): ToolMountState {
  if (input.bound)
    return "mounted";
  if (!input.policyConnectorExists)
    return "unknown_connector";
  if (!input.policy)
    return "unregistered";
  if (!isPolicyEnabled(input.policy.enabled))
    return "blocked_by_policy";
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
async function rows(sql: string, ...params: unknown[]): Promise<Row[]> {
  return (await postgresDb().many(sql, ...params)) as Row[];
}
/**
 * 技能声明的工具 × 运行目录的只读聚合：读模型只描述「声明了什么、够不够得着」，
 * 不代替挂载动作（写入口是 mount-declared）。缺配置的领域一律省略字段，不造假值。
 */
export async function skillCoverage(options: {
  connectorId?: string;
  root?: string;
} = {}): Promise<SkillCoverage> {
  (await ensureRuntimeSchema());
  const connectorId = options.connectorId?.trim() || undefined;
  const directory = new Map<string, {
    id: string;
    label: string;
    enabled: boolean;
    status: string;
  }>();
  for (const row of (await rows("SELECT id,label,enabled,status FROM connectors"))) {
    const id = String(row.id);
    directory.set(id, {
      id,
      label: String(row.label ?? id),
      enabled: Number(row.enabled) === 1,
      status: String(row.status ?? ""),
    });
  }
  const stages = new Map<string, string>();
  for (const row of (await rows("SELECT skill_id,stage FROM skill_lifecycle")))
    stages.set(String(row.skill_id), String(row.stage));
  const publishedVersions = new Map<string, number>();
  for (const row of (await rows("SELECT skill_id,MAX(version) AS version FROM skill_versions WHERE status='published' GROUP BY skill_id"))) {
    if (row.version !== null && row.version !== undefined)
      publishedVersions.set(String(row.skill_id), Number(row.version));
  }
  const boundAgents = new Map<string, string[]>();
  for (const row of (await rows("SELECT agent_id,skill_id FROM runtime_agent_skills WHERE enabled=1 ORDER BY agent_id"))) {
    const skillId = String(row.skill_id);
    boundAgents.set(skillId, [...(boundAgents.get(skillId) || []), String(row.agent_id)]);
  }
  const policies = new Map<string, {
    enabled: number;
    risk: "L1" | "L2" | "L3";
  }>();
  const approvedCounts = new Map<string, number>();
  for (const row of (await rows("SELECT connector_id,tool_name,enabled,risk FROM runtime_tool_policies"))) {
    const connector = String(row.connector_id);
    policies.set(keyOf(connector, String(row.tool_name)), {
      enabled: Number(row.enabled),
      risk: String(row.risk) as "L1" | "L2" | "L3",
    });
    if (Number(row.enabled) === 1)
      approvedCounts.set(connector, (approvedCounts.get(connector) || 0) + 1);
  }
  const connectorBindings = new Set((await listSkillConnectorBindings()).filter((row) => Number(row.enabled) === 1)
    .map((row) => keyOf(String(row.skill_id), String(row.connector_id))));
  const toolBindings = new Set((await listSkillToolBindings()).filter((row) => Number(row.enabled) === 1)
    .map((row) => keyOf(String(row.skill_id), String(row.connector_id), String(row.tool_name))));
  const skills: CoverageSkill[] = [];
  const referenced = new Set<string>();
  for (const definition of taskDefinitions(options.root)) {
    const tools: CoverageTool[] = [];
    for (const declared of parseDeclaredMcp(definition.mcp)) {
      if (connectorId && declared.connector_id !== connectorId)
        continue;
      if (declared.declared_as === DOCUMENT_TOOL) {
        tools.push({ ...declared, connector_label: "知识文档", policy_risk: "L1", policy_enabled: true,
          state: (await documentDependencies(definition.id)).length ? "mounted" : "available" });
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
      if (connector)
        referenced.add(declared.connector_id);
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
    if (connectorId && !tools.length)
      continue;
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
    .filter((connector): connector is {
    id: string;
    label: string;
    enabled: boolean;
    status: string;
  } => Boolean(connector))
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
