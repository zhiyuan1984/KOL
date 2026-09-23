/** 过程流里的长文本处理：只展开最新一段，且永不自带滚动条。 */
export const THINK_TAIL_LINES = 6;

export function thinkTail(text: string): { body: string; truncated: boolean } {
  const lines = String(text || "").split("\n").filter((line, index, all) => line.trim() || index === 0);
  if (lines.length <= THINK_TAIL_LINES) return { body: lines.join("\n").trim(), truncated: false };
  return { body: lines.slice(-THINK_TAIL_LINES).join("\n").trim(), truncated: true };
}
