/**
 * 提交后的等待文案。一份文案服务所有入口（五个页签、选技能、自由输入）：
 * 意图已读懂 → 正在分析 → 随后执行，不说别的口径。
 */
export const RECOGNIZE_WAIT_LINES: readonly string[] = [
  "你要办的事我读懂了，",
  "正在分析你的问题；",
  "分析完就开始执行——",
  "需要你确认的地方，我会先问一句。",
];

export const RECOGNIZE_WAIT_OVERDUE = "这次分析有点久；你可以继续等，或补充信息后再发一次。";

/** 每个字露出的间隔（毫秒）：46 个字约 1.4 秒讲完，只影响观感，不影响等待的真实状态。 */
export const RECOGNIZE_WAIT_MS_PER_CHAR = 30;

export type RecognizeWaitReveal = {
  visible: string[];
  done: boolean;
};

/**
 * 纯函数：给定已过去的毫秒数，算出文案露到哪一段。
 * 首帧先给一个字，不做空白卡；行数随进度增长，读完即 `done`。
 */
export function revealWaitLines(
  lines: readonly string[],
  elapsedMs: number,
  msPerChar = RECOGNIZE_WAIT_MS_PER_CHAR,
): RecognizeWaitReveal {
  const total = lines.reduce((sum, line) => sum + line.length, 0);
  const step = msPerChar > 0 ? msPerChar : RECOGNIZE_WAIT_MS_PER_CHAR;
  const budget = Math.min(total, Math.max(1, Math.floor(Math.max(0, elapsedMs) / step)));
  const visible: string[] = [];
  let remaining = budget;
  for (const line of lines) {
    if (remaining <= 0) break;
    visible.push(remaining >= line.length ? line : line.slice(0, remaining));
    remaining -= line.length;
  }
  return { visible, done: budget >= total };
}
