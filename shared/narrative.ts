/**
 * 模型的结构化输出把给员工看的说明 `narrative` 放在第一个字段，并逐字流出。
 * 在 JSON 还没闭合时就从缓冲里取出它已经生成的部分，供 Host 与页面逐字显示。
 * 返回 null 表示这段文本里还没有（或根本没有）narrative 字段。
 */
export function streamingNarrative(buffer: string): string | null {
  const source = String(buffer || "");
  const key = /"narrative"\s*:\s*"/.exec(source);
  if (!key) return null;
  let out = "";
  for (let index = key.index + key[0].length; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') return out;
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = source[index + 1];
    // 转义序列被截在缓冲末尾：先不输出，等下一段增量补齐。
    if (next === undefined) return out;
    if (next === "u") {
      const hex = source.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return out;
      out += String.fromCharCode(parseInt(hex, 16));
      index += 5;
      continue;
    }
    out += ({ n: "\n", t: "\t", r: "", b: "", f: "" } as Record<string, string>)[next] ?? next;
    index += 1;
  }
  return out;
}
