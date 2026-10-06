import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * 中栏时间流的统一滚动规则（会话页与首页工作台同一套，DESIGN §10.2）：
 * - 只有一条滚动轴；停在底部时，新内容自动跟随，最新的始终贴着输入框上方。
 * - 员工一旦上翻，就不再抢滚动；焦点在流内表单里时同样不跟随。
 * - 内容超过一屏时给一个切换按钮：不在底部 →「滚到底部」，在底部 →「滚到顶部」。
 *
 * `follow` 为 false 时（首页没有在产出的模式）不跟随；它从 false 变 true 的那一刻
 * （开始产出）把视口贴到底部。`start` 决定每次 `resetKey` 变化时从顶部还是底部开始。
 */
export function useStreamScroll({
  resetKey,
  start,
  follow,
}: {
  resetKey: unknown;
  start: "top" | "bottom";
  follow: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stick = useRef(start === "bottom");
  const focusInForm = useRef(false);
  const followRef = useRef(follow);
  followRef.current = follow;
  const [overflow, setOverflow] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const threshold = parseFloat(getComputedStyle(el).getPropertyValue("--feed-follow-threshold")) || 48;
    setOverflow(el.scrollHeight > el.clientHeight + 1);
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= threshold);
  }, []);

  const isAtBottom = (el: HTMLElement) => {
    const threshold = parseFloat(getComputedStyle(el).getPropertyValue("--feed-follow-threshold")) || 48;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  };

  useLayoutEffect(() => {
    const el = ref.current;
    focusInForm.current = false;
    if (!el) return;
    if (start === "bottom") {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    } else {
      el.scrollTop = 0;
      // 正在产出时进入：从顶部开始，下一段新内容到达就贴底跟随。
      stick.current = followRef.current;
    }
    measure();
    // resetKey 是唯一的重置信号；start 在同一个页面里不会变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => {
    if (!follow) return;
    const el = ref.current;
    stick.current = true;
    if (el) el.scrollTop = el.scrollHeight;
    measure();
  }, [follow, measure]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => track());
    const watchChildren = () => {
      if (!resize) return;
      for (const child of Array.from(el.children)) resize.observe(child);
    };
    function track() {
      if (followRef.current && stick.current && !focusInForm.current && el) el.scrollTop = el.scrollHeight;
      measure();
    }
    const mutation = new MutationObserver(() => {
      watchChildren();
      track();
    });
    mutation.observe(el, { subtree: true, childList: true, characterData: true });
    resize?.observe(el);
    watchChildren();
    const onFocusChange = () => {
      const active = document.activeElement as HTMLElement | null;
      focusInForm.current = Boolean(active && el.contains(active) && active.closest("input, textarea, select, [contenteditable='true']"));
      if (!focusInForm.current) track();
    };
    el.addEventListener("focusin", onFocusChange);
    el.addEventListener("focusout", onFocusChange);
    track();
    return () => {
      mutation.disconnect();
      resize?.disconnect();
      el.removeEventListener("focusin", onFocusChange);
      el.removeEventListener("focusout", onFocusChange);
    };
  }, [resetKey, measure]);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stick.current = isAtBottom(el);
    measure();
  }, [measure]);

  const scrollTo = useCallback((where: "top" | "bottom") => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stick.current = where === "bottom";
    el.scrollTo({ top: where === "bottom" ? el.scrollHeight : 0, behavior: reduce ? "auto" : "smooth" });
  }, []);

  /** 让某个新出现、需要员工处理的条目（例如待确认动作）进入视口：贴到底部并恢复跟随。 */
  const pinToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stick.current = true;
    el.scrollTop = el.scrollHeight;
    measure();
  }, [measure]);

  return {
    ref,
    onScroll,
    /** 内容超过一屏才给切换按钮。 */
    canJump: overflow,
    atBottom,
    toggle: () => scrollTo(atBottom ? "top" : "bottom"),
    scrollTo,
    pinToBottom,
  };
}
