import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";

/** 构建换过 hash 之后，旧标签页点开懒加载路由会拿到已删除的 chunk（nginx 会把它回成 index.html，
 *  浏览器按 MIME 拒绝执行）→ 动态 import 失败。这里把失败变成「有原因 + 有恢复入口」的提示，
 *  而不是让路由一直停在加载态（docs/DESIGN.md §不变量 3）。 */
const STALE_ASSET = /dynamically imported module|Importing a module script failed|Loading chunk|preload/i;

export default class RouteErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("route crash", this.props.label || "", error, info.componentStack);
  }

  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    const stale = STALE_ASSET.test(String(error.message || ""));
    return (
      <div className="route-error" role="alert" data-route-error>
        <h2>{stale ? "页面资源已更新" : "这个页面没能打开"}</h2>
        <p className="muted">
          {stale
            ? "这次部署换掉了旧的文件名，当前标签页拿不到它。刷新后就能正常打开，输入的内容会保留在草稿里。"
            : String(error.message || error)}
        </p>
        <button type="button" className="btn work" data-route-error-reload onClick={() => location.reload()}>
          刷新页面
        </button>
      </div>
    );
  }
}

/** 懒加载路由的等待态：8 秒还没出来就给「刷新」入口 ——
 *  部署换过资源名时请求可能一直悬着（既不成功也不失败），这时 Suspense 会永远停在加载中。 */
export function RouteLoadingFallback() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="route-loading" data-route-loading>
      <p className="muted">加载中…</p>
      {slow ? (
        <p className="muted" data-route-slow>
          还没加载出来。若是刚部署过，刷新一下就能拿到新资源。
          <button type="button" className="link-reload" data-route-slow-reload onClick={() => location.reload()}>
            刷新
          </button>
        </p>
      ) : null}
    </div>
  );
}
