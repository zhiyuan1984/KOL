import { describe, expect, it } from "vitest";
import type { KnowledgeBaseRow, KnowledgeDomainRow } from "../../api";
import { buildPlanningTree, filterPlanningTree, flattenPlanningTree, planningBranchKeys, planningChildSummary, planningMutationError, planningStateLabel } from "./planningTree";

const domains: KnowledgeDomainRow[] = [
  { id: "f", code: "products", name: "产品方案", level: "family", parent_id: null, status: "active" },
  { id: "d", code: "battery", name: "电池产品", level: "domain", parent_id: "f", status: "active" },
  { id: "empty", code: "empty", name: "空业务域", level: "domain", parent_id: "f", status: "archived" },
];
const bases: KnowledgeBaseRow[] = [
  { id: "b", code: "lifepo4", name: "磷酸铁锂知识库", domain_id: "d", kind: "structured", status: "active", entries: 2 },
];

describe("knowledge planning tree", () => {
  it("builds exactly family → domain → base with stable level-scoped IDs and empty nodes", () => {
    const tree = buildPlanningTree(domains, bases);
    expect(tree.detached).toEqual([]);
    expect(flattenPlanningTree(tree.roots).map(node => node.key).sort()).toEqual(["base:b", "domain:d", "domain:empty", "family:f"]);
    expect(tree.roots[0].children.find(node => node.row.id === "d")?.children[0].path).toEqual(["产品方案", "电池产品", "磷酸铁锂知识库"]);
    expect(tree.roots[0].children.find(node => node.row.id === "empty")?.isLeaf).toBe(true);
    expect(planningBranchKeys(tree.roots).sort()).toEqual(["domain:d", "family:f"]);
  });
  it("retains ancestor paths for name and code search without changing the source tree", () => {
    const { roots } = buildPlanningTree(domains, bases);
    const result = filterPlanningTree(roots, "LIFEPO4");
    expect(flattenPlanningTree(result).map(node => node.level)).toEqual(["family", "domain", "base"]);
    expect(result[0].children[0].children[0].title).toBe("磷酸铁锂知识库");
    expect(roots[0].children).toHaveLength(2);
    expect(filterPlanningTree(roots, "产品方案")[0].children).toHaveLength(2);
    expect(filterPlanningTree(roots, "missing")).toEqual([]);
    expect(filterPlanningTree(roots, " ")).toBe(roots);
  });
  it("preserves malformed parent links visibly without inventing ancestry", () => {
    const tree = buildPlanningTree([...domains, { ...domains[1], id: "orphan", parent_id: "missing" }], [
      ...bases, { ...bases[0], id: "orphan-base", domain_id: "missing" }, { ...bases[0], id: "child", domain_id: "orphan" },
    ]);
    expect(tree.detached.map(node => node.key)).toEqual(["domain:orphan", "base:orphan-base"]);
    expect(tree.detached[0].children[0].key).toBe("base:child");
    expect(flattenPlanningTree([...tree.roots, ...tree.detached])).toHaveLength(7);
  });
  it("does not mutate API arrays or hide archived nodes", () => {
    const before = JSON.stringify({ domains, bases });
    const { roots } = buildPlanningTree(domains, bases);
    expect(JSON.stringify({ domains, bases })).toBe(before);
    expect(flattenPlanningTree(roots).find(node => node.row.id === "empty")?.row.status).toBe("archived");
    expect(planningChildSummary(roots[0])).toBe("2 个业务域");
    const base = flattenPlanningTree(roots).find(node => node.level === "base")!;
    expect(planningChildSummary(base)).toBe("2 条条目");
    expect(planningChildSummary({ ...base, level: "base", row: { ...bases[0], kind: "unstructured", entries: 0 } })).toBe("资料库");
  });
  it("keeps node status distinct from publication status and labels unknown states honestly", () => {
    expect(planningStateLabel("active")).toBe("启用");
    expect(planningStateLabel("archived")).toBe("已归档");
    expect(planningStateLabel("published")).toBe("未知状态：published");
    expect(planningStateLabel()).toBe("状态待核对");
  });
  it("preserves the known-safe undeployed-guard rejection instead of claiming unknown commit", () => {
    const message = "安全删除与归档尚未启用，请先由运维部署知识分类保护迁移";
    for (const payload of [{ code: "knowledge_taxonomy_guard_required" }, { detail: { code: "knowledge_taxonomy_guard_required" } }]) {
      expect(planningMutationError({ status: 503, message, payload })).toEqual({ message, needsReload: false, uncertain: false });
    }
  });
  it("requires reload for stale/dependency conflicts and uncertain writes", () => {
    expect(planningMutationError({ status: 409, message: "有子节点" }).needsReload).toBe(true);
    expect(planningMutationError({ status: 412 }).needsReload).toBe(true);
    expect(planningMutationError({ status: 0 }).uncertain).toBe(true);
    expect(planningMutationError({ status: 502 }).uncertain).toBe(true);
    expect(planningMutationError({ status: 504 }).uncertain).toBe(true);
    expect(planningMutationError(new TypeError("Failed to fetch")).uncertain).toBe(true);
    expect(planningMutationError({ status: 403, message: "无权限" })).toEqual({ message: "无权限", needsReload: false, uncertain: false });
  });
});
