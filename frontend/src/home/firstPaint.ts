/**
 * 壳读让位首屏：与首屏内容无关的读（侧栏 badge、会话、任务目录、任务定义等）
 * 旧端点仍有同步查询，壳读应让位给当前面的首读。
 * 公海 Home 懒加载时，不能从父壳挂载开始计时，否则壳读可能抢在页面模块前。
 */
export const SHELL_READ_DELAY_MS = 350;

const POOL_READ_STARTED = "home:pool-read-started";
let poolReadStarted = false;

export function announcePoolReadStarted(): void {
  poolReadStarted = true;
  window.dispatchEvent(new Event(POOL_READ_STARTED));
}

/** Wait for the public pool's actual first read, then apply the existing shell delay. */
export function scheduleShellRead(read: () => void): () => void {
  let timer: number;
  const begin = () => {
    window.clearTimeout(timer);
    window.removeEventListener(POOL_READ_STARTED, begin);
    timer = window.setTimeout(read, SHELL_READ_DELAY_MS);
  };
  const poolEntry = window.location.pathname === "/" && new URLSearchParams(window.location.search).get("tab") === "pool";
  if (poolEntry && !poolReadStarted) {
    window.addEventListener(POOL_READ_STARTED, begin, { once: true });
    // A failed lazy module must not permanently suppress shell recovery reads.
    timer = window.setTimeout(begin, 10_000);
  } else begin();
  return () => { window.clearTimeout(timer); window.removeEventListener(POOL_READ_STARTED, begin); };
}
