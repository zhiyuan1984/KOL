/**
 * 新环境必需的参考数据：连接器目录与默认知识分类。
 *
 * 这两项此前只由 `db.ts` 的 `migrateSchema`（SQLite 专属）用 `app_state` 门控回填，
 * 而 PG 引擎不跑 `migrateSchema`，导致任何新建的 PG 库缺数据（表现为
 * 「没有可用的结构化知识库」）。现在常量收敛到这里，由 PG 迁移步骤写入；
 * 删除 SQLite 后这里就是唯一来源。
 */
import { BUILTIN_CONNECTORS } from "./connectors/catalog.js";

export type ConnectorSeedRow = { id: string; label: string; purpose: string };

export function builtinConnectorRows(): ConnectorSeedRow[] {
  return Object.entries(BUILTIN_CONNECTORS).map(([id, connector]) => ({
    id,
    label: connector.label,
    purpose: connector.purpose,
  }));
}

export type KnowledgeDomainSeedRow = {
  id: string;
  code: string;
  name: string;
  level: string;
  parent_id: string | null;
  sort: number;
};

export type KnowledgeBaseSeedRow = {
  id: string;
  code: string;
  name: string;
  domain_id: string;
  kind: string;
  description: string;
  settings: string;
  version: number;
};

/** 默认族 → 域 → 结构化库：系统写入（抽取候选等）的默认落点。 */
export const DEFAULT_KNOWLEDGE_DOMAINS: KnowledgeDomainSeedRow[] = [
  { id: "kdom_uncategorized", code: "uncategorized", name: "未分类", level: "family", parent_id: null, sort: 999 },
  { id: "kdom_legacy", code: "legacy", name: "未分类", level: "domain", parent_id: "kdom_uncategorized", sort: 999 },
];

export const DEFAULT_KNOWLEDGE_BASES: KnowledgeBaseSeedRow[] = [
  {
    id: "kbase_legacy",
    code: "legacy",
    name: "历史知识",
    domain_id: "kdom_legacy",
    kind: "structured",
    description: "2026-10-01 分层迁移前的历史条目",
    settings: "{}",
    version: 1,
  },
];
