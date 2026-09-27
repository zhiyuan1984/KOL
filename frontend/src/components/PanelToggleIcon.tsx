/**
 * 侧栏 / 结果栏的收起-展开控件图标：Lucide `panel-right` / `panel-left`
 * （ISC，lucide-static v1.48.0 源：`<rect width="18" height="18" x="3" y="3" rx="2"/>`
 *  + `<path d="M15 3v18"/>`）。全仓库共用这一份，不再各自画箭头；
 * 方向只按被折叠的那一侧选：左栏用左侧栏，右栏用右侧栏。
 */
export default function PanelToggleIcon({
  side = "right",
  className,
}: {
  side?: "left" | "right";
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d={side === "left" ? "M9 3v18" : "M15 3v18"} />
    </svg>
  );
}
