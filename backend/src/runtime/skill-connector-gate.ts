import { postgresDb } from "../postgres/access.js";
import { taskDefinition } from "../tasks/registry.js";
import type { Row } from "../types.js";
import { DOCUMENT_TOOL } from "./document-knowledge.js";
import { parseDeclaredMcp, toolMountState } from "./skill-coverage.js";
import { getToolPolicy, listSkillConnectorBindings, listSkillToolBindings } from "./store.js";
export type ConnectorGapReason = "connector_unbound" | "no_tool_bound";
export type ConnectorGap = {
  connector_id: string;
  reason: ConnectorGapReason;
};
/** `SkillExecution.discover()` 的对外形状（只取判定需要的两列）。 */
export type DiscoveredCatalog = {
  tools: ReadonlyArray<{
    connectorId: string;
  }>;
  unavailable: ReadonlyArray<{
    connector_id: string;
    code: string;
  }>;
};
async function registeredConnectorIds(): Promise<Set<string>> {
  return new Set(((await postgresDb().many("SELECT id FROM connectors")) as Row[]).map((row) => String(row.id)));
}
/**
 * 技能声明里指向已登记受管连接器的 id，遍历次序同 `skill-coverage` 的声明解析。
 * 知识文档工具由本地知识库承接，未登记别名（legacy `starry.*`、`kolclaw.*`）没有目录行：
 * 两者都不是运行时连接，不能当作缺口。
 */
export async function declaredManagedConnectors(skillId: string): Promise<string[]> {
  const definition = taskDefinition(skillId);
  if (!definition)
    return [];
  const registered = (await registeredConnectorIds());
  const ids: string[] = [];
  for (const declared of parseDeclaredMcp(definition.mcp)) {
    if (declared.declared_as === DOCUMENT_TOOL || !declared.connector_id)
      continue;
    if (!registered.has(declared.connector_id) || ids.includes(declared.connector_id))
      continue;
    ids.push(declared.connector_id);
  }
  return ids;
}

/**
 * 技能声明的已登记连接器里，当前一个工具也够不着的那些：该连接器的父绑定没启用，
 * 或启用的技能工具绑定数为 0。只读本地治理库、不发远端请求——技能完全没有挂载行时
 * `discover()` 连 `unavailable` 都记不出来，只有在这里才能提前拦住「绑定缺失被当成没有工具」。
 * 只把「策略已放行、却没挂载」算作未接通：声明工具全部受写入策略约束时，那是等管理员
 * 审批策略的另一种治理状态，技能可能仍有不依赖远端的本职（如谈判纪要整理本地摘要），不能整体拦掉。
 */
export async function skillConnectorGaps(skillId: string): Promise<ConnectorGap[]> {
  const connectors = (await declaredManagedConnectors(skillId));
  if (!connectors.length)
    return [];
  const enabledParents = new Set((await listSkillConnectorBindings()).filter((row) => String(row.skill_id) === skillId && Number(row.enabled) === 1)
    .map((row) => String(row.connector_id)));
  const enabledToolCounts = new Map<string, number>();
  for (const row of (await listSkillToolBindings())) {
    if (String(row.skill_id) !== skillId || Number(row.enabled) !== 1)
      continue;
    const connectorId = String(row.connector_id);
    enabledToolCounts.set(connectorId, (enabledToolCounts.get(connectorId) || 0) + 1);
  }
  const declared = parseDeclaredMcp(taskDefinition(skillId)?.mcp || []);
  const mountable = async (connectorId: string): Promise<boolean> => (await Promise.all(declared
    .filter((tool) => tool.connector_id === connectorId)
    .map(async (tool) => toolMountState({
      declared: tool,
    policy: (await getToolPolicy(connectorId, tool.tool_name)) as {
      enabled: number;
    } | undefined,
      policyConnectorExists: true,
      bound: false,
  }) === "available"))).some(Boolean);
  const gaps: ConnectorGap[] = [];
  for (const connectorId of connectors) {
    if (!(await mountable(connectorId)))
      continue;
    if (!enabledParents.has(connectorId)) {
      gaps.push({ connector_id: connectorId, reason: "connector_unbound" });
      continue;
    }
    if (!enabledToolCounts.get(connectorId))
      gaps.push({ connector_id: connectorId, reason: "no_tool_bound" });
  }
  return gaps;
}

/**
 * 声明了已登记连接器、远端发现却没给出该连接器任何一个工具时的第一个失败项。
 * 只认 `discover()` 真的记进 `unavailable` 的连接器：没有挂载行时它连失败都不记，
 * 那条路径由 `skillConnectorGaps` 前置拦截，这里不能凭空推断。
 */
export async function unusableDiscoveredConnector(skillId: string, catalog: DiscoveredCatalog): Promise<{
  connector_id: string;
  code: string;
} | null> {
  const discovered = new Set(catalog.tools.map((tool) => tool.connectorId));
  for (const connectorId of (await declaredManagedConnectors(skillId))) {
    if (discovered.has(connectorId))
      continue;
    const failure = catalog.unavailable.find((entry) => entry.connector_id === connectorId);
    if (failure)
      return { connector_id: connectorId, code: failure.code };
  }
  return null;
}
