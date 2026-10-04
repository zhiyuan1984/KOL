import { runtimeRequiresGate } from "../gateway/runtime-policy.js";
import { toolSchemaHash } from "./execution.js";
import { getToolPolicy, setToolPolicy } from "./store.js";
import type { Json } from "../types.js";

/** 只读家族：`07-mcp-data-contract.md`「画像读取、邮件读取、爬虫状态为 L1」。 */
const READ_FAMILY = /^(page|list|get|read|search|query|status|summarize|translate|download|count|fetch|check)/i;
/** 敏感家族：07 的「发送、解密、导入、删除」按 L3 处理；阶段写入另由发布名单兜住。 */
const SENSITIVE_FAMILY = /^(send|delete|decrypt|import|upload|clear|confirm)/i;
const HEX64 = /^[0-9a-f]{64}$/;

export type DerivedToolPolicy = { risk: "L1" | "L2" | "L3"; access: "read" | "write" };

/**
 * 工具风险档的平台推导（唯一实现处）。发布名单与敏感家族 → L3；只读家族 → L1；
 * 草稿、预览与无法判定者保守落 L2。结果只是内部门禁与审计字段，不是界面授权操作。
 */
export function deriveToolPolicy(name: string): DerivedToolPolicy {
  const bare = String(name || "").split(/[.:/]/).at(-1) || "";
  if (runtimeRequiresGate(bare)) return { risk: "L3", access: "write" };
  if (SENSITIVE_FAMILY.test(bare)) return { risk: "L3", access: "write" };
  if (READ_FAMILY.test(bare)) return { risk: "L1", access: "read" };
  return { risk: "L2", access: "write" };
}

/** Discovery 结果可能已带指纹；没有时按不含指纹的形状补算，保证策略行可用。 */
export function policyHashOf(tool: Json): string {
  const given = typeof tool.schema_hash === "string" ? tool.schema_hash.trim().toLowerCase() : "";
  if (HEX64.test(given)) return given;
  const { schema_hash: _ignored, ...rest } = tool as Record<string, unknown>;
  return toolSchemaHash(rest as Json);
}

export type ToolCatalogRegistration = { total: number; created: number; refreshed: number; skipped: number };

/**
 * 测试（probe）成功后登记发现的工具目录。发现不是授权：挂载仍在技能侧逐项进行，
 * 管理员也可继续用既有策略接口覆盖。既有行保留风险档与启用状态（覆盖不被回写），
 * 只在远端指纹变化时刷新指纹。L3 可挂载；执行由统一提交门禁控制。
 */
export function registerDiscoveredToolPolicies(connectorId: string, tools: Json[]): ToolCatalogRegistration {
  const result: ToolCatalogRegistration = { total: tools.length, created: 0, refreshed: 0, skipped: 0 };
  for (const tool of tools) {
    const name = typeof tool.name === "string" ? tool.name.trim() : "";
    if (!name) {
      result.skipped += 1;
      continue;
    }
    const schemaHash = policyHashOf(tool);
    const existing = getToolPolicy(connectorId, name);
    if (!existing) {
      const derived = deriveToolPolicy(name);
      setToolPolicy(connectorId, name, {
        enabled: true,
        risk: derived.risk,
        access: derived.access,
        schema_hash: schemaHash,
      }, 0);
      result.created += 1;
      continue;
    }
    if (String(existing.schema_hash || "").trim().toLowerCase() !== schemaHash) {
      setToolPolicy(connectorId, name, {
        enabled: Number(existing.enabled) === 1,
        risk: String(existing.risk) as DerivedToolPolicy["risk"],
        access: String(existing.access) as DerivedToolPolicy["access"],
        schema_hash: schemaHash,
      }, Number(existing.version) || 0);
      result.refreshed += 1;
    }
  }
  return result;
}
