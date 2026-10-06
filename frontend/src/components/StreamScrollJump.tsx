import type { ButtonHTMLAttributes } from "react";

/**
 * 中栏时间流的唯一跳转控件（会话页与首页同一个）：不在底部时「滚到底部」，
 * 在底部时「滚到顶部」。不带新内容条数（DESIGN §10.2）。
 */
export default function StreamScrollJump({
  atBottom,
  onClick,
  ...attrs
}: { atBottom: boolean; onClick: () => void } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const label = atBottom ? "滚到顶部" : "滚到底部";
  return (
    <button
      type="button"
      className="scope-scroll-jump"
      data-stream-scroll-jump={atBottom ? "top" : "bottom"}
      data-tooltip={label}
      aria-label={label}
      onClick={onClick}
      {...attrs}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={atBottom ? "M12 20V5m-7 7 7-7 7 7" : "M12 4v15m-7-7 7 7 7-7"} />
      </svg>
    </button>
  );
}
