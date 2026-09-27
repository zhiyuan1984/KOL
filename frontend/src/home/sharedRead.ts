/**
 * 同一资源在飞行中的读共享同一个 promise：没读完就不重复发第二条。
 * 不做结果缓存——读取结果一旦落屏，是否重读由各面自己的刷新时机决定，
 * 避免在领取/释放/同步之后把旧快照重新贴回屏幕。
 */
const inFlight = new Map<string, Promise<unknown>>();

export function sharedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const run: Promise<T> = read();
  const tracked = run.finally(() => {
    if (inFlight.get(key) === tracked) inFlight.delete(key);
  });
  inFlight.set(key, tracked);
  return tracked;
}
