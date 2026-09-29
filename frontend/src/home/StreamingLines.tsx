import { useEffect, useMemo, useState } from "react";
import { revealWaitLines } from "./recognizeWait";

/**
 * 等待卡的逐字流式正文：视觉上是「agent 正在说」。
 * 动画文本对读屏隐藏，另给一份完整文案（避免读屏跟着一个字一个字播报）；
 * `prefers-reduced-motion` 时直接出全文，不做动画。
 */
export default function StreamingLines({ lines, seconds = 0 }: { lines: readonly string[]; seconds?: number }) {
  const reduced = usePrefersReducedMotion();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const startedAt = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - startedAt), 40);
    return () => window.clearInterval(timer);
  }, [reduced]);

  const reveal = useMemo(
    () => (reduced ? { visible: [...lines], done: true } : revealWaitLines(lines, elapsed)),
    [elapsed, lines, reduced],
  );

  return (
    <>
      <p className="wait-stream" aria-hidden="true" data-wait-stream={reveal.done ? "done" : "streaming"}>
        {reveal.visible.map((line, index) => <span key={index}>{line}</span>)}
      </p>
      <p className="sr-only" data-wait-stream-full>{lines.join("")}</p>
      {seconds > 0 ? <p className="muted" data-recognize-elapsed>已等待 {seconds} 秒</p> : null}
    </>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ));
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return reduced;
}
