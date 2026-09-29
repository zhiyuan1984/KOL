/** 请求头名的字符集与保留名；与后端 `backend/src/runtime/store.ts` 的校验保持同一套规则。 */
export const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
export const RESERVED_HEADERS = new Set([
  "content-length", "host", "connection", "transfer-encoding", "upgrade", "keep-alive", "proxy-connection",
]);

export function validateHeaderName(name: string, label = "请求头名称"): string {
  if (!HEADER_NAME.test(name)) return label + "只能包含 token 字符（字母、数字与 !#$%&'*+-.^_`|~）。";
  if (RESERVED_HEADERS.has(name.toLowerCase())) return label + `「${name}」由传输层保留，不能使用。`;
  return "";
}

/** 常用请求头名：点开 Header 名称即可选，自定义名仍照常输入。 */
export const COMMON_HEADER_NAMES = ["X-MCP-API-KEY", "Authorization", "Content-Type", "Accept"] as const;

/**
 * 推荐值 = 常用名里剔除本表单已占用的名字（忽略大小写）。
 * 同一表单里的同名两行会在保存时被合并成一个（后写覆盖先写），所以不再推荐已用过的名字。
 */
export function suggestHeaderNames(used: Iterable<string>, known: readonly string[] = COMMON_HEADER_NAMES): string[] {
  const taken = new Set<string>();
  for (const name of used) {
    const normalized = name.trim().toLowerCase();
    if (normalized) taken.add(normalized);
  }
  return known.filter((name) => !taken.has(name.toLowerCase()));
}

/** 同一表单里除当前行以外的头名，用于过滤推荐值。 */
export function otherHeaderNames(rows: ReadonlyArray<{ name: string }>, index: number): string[] {
  return rows.filter((_, position) => position !== index).map((row) => row.name);
}

const SUGGESTION_HINTS: Record<string, string> = {
  authorization: "值按原样发送，需要自带 Bearer 前缀（如 Bearer eyJ…）。",
  "x-mcp-api-key": "平台内置 MCP（Starry KOL / email-agent）使用此头；值写入凭据保险库，调用时按同名请求头发送，保存后不回显。",
  "content-type": "通常由传输层自动设置；仅当服务端要求额外值时才填写。",
  accept: "通常由传输层自动设置；仅当服务端要求额外值时才填写。",
};

/**
 * 已知头名的一行说明；自定义名没有额外说明。
 * `bearerReference` 只在该表单确实有 Bearer 引用（bearer_env / bearer_secret_ref）时开启：
 * 手工 Authorization 保存后会替换那条引用，没有引用时不该提这回事。
 */
export function headerNameHint(name: string, options: { bearerReference?: boolean } = {}): string {
  const normalized = name.trim().toLowerCase();
  const hint = SUGGESTION_HINTS[normalized] || "";
  if (normalized === "authorization" && options.bearerReference) {
    return hint + "保存后会替换已配置的 Bearer 引用，不会两个头同时发送。";
  }
  return hint;
}
