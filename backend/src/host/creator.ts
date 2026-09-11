/**
 * 从用户文本抽出 Claw 创作者 id（cr_…）。
 * 读数由 Skill MCP 完成；Host 不再在起箱前写 creator_snapshot.json。
 */

const CREATOR_ID_RE = /\b(cr_[A-Za-z0-9_]+)\b/;

export function extractCreatorId(text: string): string | null {
  const m = CREATOR_ID_RE.exec(text || "");
  return m ? m[1] : null;
}
