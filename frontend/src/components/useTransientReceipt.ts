import { useCallback, useEffect, useRef, useState } from "react";

export type TransientReceipt = { text: string; visible: boolean };

const EMPTY: TransientReceipt = { text: "", visible: false };

/**
 * 回执回答的是「刚才那一次动作发生了什么」，不是页面的当前状态。
 * 所以它必须自己消失：到点先淡出（摘掉 is-visible），再卸载。
 * 同一文案连续出现时重新计时，第二次动作不会因为文案相同而看不到提示。
 */
export function useTransientReceipt(timeoutMs = 6000, fadeMs = 200) {
  const [receipt, setReceipt] = useState<TransientReceipt>(EMPTY);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (dropTimer.current) clearTimeout(dropTimer.current);
    hideTimer.current = null;
    dropTimer.current = null;
  }, []);

  const clearReceipt = useCallback(() => {
    stop();
    setReceipt(EMPTY);
  }, [stop]);

  const showReceipt = useCallback((text: string) => {
    stop();
    if (!text) {
      setReceipt(EMPTY);
      return;
    }
    setReceipt({ text, visible: true });
    hideTimer.current = setTimeout(() => {
      setReceipt((current) => (current.text === text ? { text, visible: false } : current));
      dropTimer.current = setTimeout(() => {
        setReceipt((current) => (current.text === text ? EMPTY : current));
      }, fadeMs);
    }, timeoutMs);
  }, [fadeMs, timeoutMs, stop]);

  useEffect(() => stop, [stop]);

  return { receipt, showReceipt, clearReceipt };
}
