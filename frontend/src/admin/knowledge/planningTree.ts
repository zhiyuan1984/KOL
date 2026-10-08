import type { KnowledgeBaseRow, KnowledgeDomainRow } from "../../api";

export type PlanningLevel = "family" | "domain" | "base";
type PlanningNodeFields = {
  key: string;
  title: string;
  path: string[];
  children: PlanningNode[];
  isLeaf: boolean;
};
export type PlanningNode = PlanningNodeFields & (
  | { level: "family" | "domain"; row: KnowledgeDomainRow }
  | { level: "base"; row: KnowledgeBaseRow }
);

export const planningKey = (level: PlanningLevel, id: string) => `${level}:${id}`;

export function sortPlanningRows(a: { sort?: number; name?: string; id: string }, b: { sort?: number; name?: string; id: string }): number {
  return Number(a.sort || 0) - Number(b.sort || 0)
    || String(a.name || "").localeCompare(String(b.name || ""), "zh-CN")
    || a.id.localeCompare(b.id);
}

/** Only authoritative parent IDs establish ancestry. Broken links stay visible separately. */
export function buildPlanningTree(domains: KnowledgeDomainRow[], bases: KnowledgeBaseRow[]): { roots: PlanningNode[]; detached: PlanningNode[] } {
  const families = domains.filter(row => row.level === "family").sort(sortPlanningRows);
  const topics = domains.filter(row => row.level === "domain").sort(sortPlanningRows);
  const baseRows = [...bases].sort(sortPlanningRows);
  const familyIds = new Set(families.map(row => row.id));
  const domainIds = new Set(topics.map(row => row.id));
  const baseNode = (row: KnowledgeBaseRow, path: string[]): PlanningNode => ({
    key: planningKey("base", row.id), title: row.name || row.code, level: "base", row,
    path: [...path, row.name || row.code], children: [], isLeaf: true,
  });
  const domainNode = (row: KnowledgeDomainRow, path: string[]): PlanningNode => {
    const ownPath = [...path, row.name || row.code];
    const children = baseRows.filter(base => base.domain_id === row.id).map(base => baseNode(base, ownPath));
    return { key: planningKey("domain", row.id), title: row.name || row.code, level: "domain", row, path: ownPath, children, isLeaf: !children.length };
  };
  const roots: PlanningNode[] = families.map(row => {
    const path = [row.name || row.code];
    const children = topics.filter(domain => domain.parent_id === row.id).map(domain => domainNode(domain, path));
    return { key: planningKey("family", row.id), title: row.name || row.code, level: "family", row, path, children, isLeaf: !children.length };
  });
  const detached: PlanningNode[] = [
    ...topics.filter(row => !familyIds.has(String(row.parent_id || ""))).map(row => domainNode(row, [])),
    ...baseRows.filter(row => !domainIds.has(row.domain_id)).map(row => baseNode(row, [])),
  ];
  return { roots, detached };
}

export function flattenPlanningTree(nodes: PlanningNode[]): PlanningNode[] {
  return nodes.flatMap(node => [node, ...flattenPlanningTree(node.children)]);
}

export function planningBranchKeys(nodes: PlanningNode[]): string[] {
  return flattenPlanningTree(nodes).filter(node => node.children.length).map(node => node.key);
}

/** A descendant match keeps its full ancestor path; a parent match shows that subtree. */
export function filterPlanningTree(nodes: PlanningNode[], query: string): PlanningNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return nodes;
  return nodes.flatMap(node => {
    if ([node.title, node.row.code].some(value => value.toLocaleLowerCase().includes(needle))) return [node];
    const children = filterPlanningTree(node.children, needle);
    return children.length ? [{ ...node, children }] : [];
  });
}

/** Container state is independent of a knowledge entry's publication lifecycle. */
export function planningStateLabel(status?: string): string {
  return status === "active" ? "启用" : status === "archived" ? "已归档" : status ? `未知状态：${status}` : "状态待核对";
}

export function planningChildSummary(node: PlanningNode): string {
  if (node.level === "family") return `${node.children.length} 个业务域`;
  if (node.level === "domain") return `${node.children.length} 个知识库`;
  return node.level === "base" && node.row.kind === "structured" && node.row.entries !== undefined ? `${Number(node.row.entries || 0)} 条条目` : "资料库";
}

export function planningMutationError(cause: unknown): { message: string; needsReload: boolean; uncertain: boolean } {
  const error = cause as { status?: number; message?: string; payload?: { error?: string; code?: string; detail?: { code?: string } } } | null;
  const code = String(error?.payload?.code || error?.payload?.detail?.code || error?.payload?.error || "");
  if (code === "knowledge_taxonomy_guard_required") return {
    message: error?.message || "安全删除与归档尚未启用，请先由运维部署知识分类保护迁移。",
    needsReload: false, uncertain: false,
  };
  const needsReload = error?.status === 409 || error?.status === 412;
  const uncertain = error?.status === 0 || Number(error?.status) >= 500 || (cause instanceof TypeError);
  const message = error?.message || "操作失败，请检查后重试。";
  if (uncertain) return { message: "请求中断，是否保存尚未确认。请先重新读取目录并核对结果，不要直接重复提交。", needsReload: true, uncertain: true };
  if (needsReload) return {
    message: `${message}${/version|stale|conflict/i.test(code) ? " 当前记录已变化。" : ""} 请重新读取目录；你的输入会保留，核对后再提交。`,
    needsReload: true, uncertain: false,
  };
  return { message, needsReload: false, uncertain: false };
}
