/** 固定管理集合路由由各处理器校验管理权限；条目子资源仍须核验知识所属组织。
 * Hono 的 /:id/* 也会匹配集合路径本身，不能把 feedback 当成知识 ID。
 */
const collections = new Set([
  "documents", "bases", "domains", "workspace-v1", "entries", "publication-v2",
  "bindings", "raw", "extract", "proposals", "feedback", "extract-jobs", "review",
  "deprecate-stats", "assets", "resolve-preview", "index-health",
]);
export function requiresKnowledgeEntryAuthorization(id: string): boolean {
  return !collections.has(id);
}
