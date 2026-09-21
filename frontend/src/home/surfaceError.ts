/**
 * 工作台各面（board / 跟进 / 公海）读取失败的对外文案。
 * 底层 HTTP 原文只留在 `detail`，供 title / data-* 排查，不作为界面正文
 * （design-system/kol-workbench/pages/home.md §状态与响应式：不得只显示底层 HTTP 文案）。
 */
export type SurfaceErrorView = {
  message: string;
  detail: string;
};

/** 会各自读一次工作台记忆、也会各自失败的两个面。 */
export type HomeSurface = "following" | "pool";

export type SurfaceDownView = SurfaceErrorView & {
  retrying?: boolean;
  onRetry?: () => void;
  onHandoff?: () => void;
};

const GATEWAY = /请求失败\s*\(\s*50[0-9]\s*\)|\b50[0-9]\b|bad gateway|gateway time-?out|上游|服务(?:暂时)?不可用/i;
const TIMEOUT = /超时|timed?\s?out/i;
const OFFLINE = /failed to fetch|fetch failed|network ?error|err_connection|err_internet|socket hang up|网络中断|连接(?:被)?(?:重置|拒绝|中断)/i;
const DENIED = /authentication required|unauthorized|forbidden|权限|\b40[13]\b/i;

function rawText(raw: unknown): string {
  if (raw instanceof Error) return raw.message.trim();
  if (typeof raw === "string") return raw.trim();
  return "";
}

/** 把一次失败的工作台读取映射成可读文案；原始文本只随 detail 返回。 */
export function surfaceErrorView(raw: unknown, fallback: string): SurfaceErrorView {
  const detail = rawText(raw);
  if (DENIED.test(detail)) return { message: "当前账号没有读取权限，请联系管理员。", detail };
  if (TIMEOUT.test(detail)) return { message: "请求超时，服务没有在时限内响应。", detail };
  if (GATEWAY.test(detail)) return { message: "上游服务暂时不可用，稍后可重试。", detail };
  if (OFFLINE.test(detail)) return { message: "网络中断，这次没有读到数据。", detail };
  return { message: fallback, detail };
}

/** 供 pane 的 down 空态直接消费：可读文案 + 两个真实动作（重试 / 交给 Agent）。 */
export function surfaceDownView(
  raw: unknown,
  fallback: string,
  actions: Pick<SurfaceDownView, "retrying" | "onRetry" | "onHandoff">,
): SurfaceDownView {
  return { ...surfaceErrorView(raw, fallback), ...actions };
}
