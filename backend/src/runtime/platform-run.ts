/**
 * 平台后台作业以系统主体运行一个已装配技能里的单个只读工具。
 * 与员工的技能执行走同一条闸门：智能体已发布 → 技能已装配且已发布 → 技能↔连接器、技能↔工具已挂载 →
 * 工具已登记且风险档允许 → 连接器启用且已配置。受控动作（L3）一律不允许由后台作业执行。
 */
import { randomUUID } from "node:crypto";
import { HttpFail } from "../host/errors.js";
import { normalizeMcpContent } from "../mcp/remote.js";
import type { Json } from "../types.js";
import { SkillExecution } from "./execution.js";
import type { RemoteMcpOptions } from "../mcp/remote.js";
import type { RuntimeRemote } from "./execution.js";
import { PLATFORM_PRINCIPAL, PLATFORM_SYNC_AGENT } from "./platform-principal.js";

export async function runPlatformSkillTool(
  skillId: string,
  connectorId: string,
  toolName: string,
  args: Json = {},
  clientFactory?: (options: RemoteMcpOptions) => RuntimeRemote,
): Promise<Json> {
  const execution = new SkillExecution({
    agentId: PLATFORM_SYNC_AGENT,
    skillId,
    userId: PLATFORM_PRINCIPAL,
    runId: `platform-sync:${randomUUID()}`,
  }, clientFactory);
  try {
    const catalog = await execution.discover();
    const handle = catalog.tools.find((tool) => tool.connectorId === connectorId && tool.remoteName === toolName);
    if (!handle) {
      throw new HttpFail(409, {
        code: "platform_sync_tool_unavailable",
        message: `后台同步不可用：技能 ${skillId} 没有可用的 ${connectorId}.${toolName}（需装配到平台同步 Agent，并挂载、登记该工具）。`,
        unavailable: catalog.unavailable,
      });
    }
    if ((handle.exposed._meta as Json | undefined)?.confirmation_required) {
      throw new HttpFail(409, { code: "platform_sync_controlled_tool", message: "后台作业不能执行需要确认的工具。" });
    }
    const result = await execution.invoke(String(handle.exposed.name), args);
    const normalized = normalizeMcpContent(result as Record<string, unknown>);
    if ((result as Json).isError) throw new Error(String(normalized.text || "remote MCP tool failed"));
    return normalized;
  } finally {
    execution.close();
  }
}
