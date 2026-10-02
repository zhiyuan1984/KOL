/** 知识页共用内联图标（描边路径口径与 space-3 原型一致；尺寸与描边由 .kbv svg 样式决定）。 */
const KBV_ICON_PATHS: Record<string, string> = {
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  file: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
  mail: "M3 5h18v14H3z M3 5l9 8 9-8",
  close: "M6 6l12 12 M18 6L6 18",
  plus: "M12 5v14 M5 12h14",
  book: "M3 5h7l2 2 2-2h7v15h-7l-2 1-2-1H3z M12 7v14",
  back: "M15 5l-7 7 7 7",
};

export default function KbvIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={KBV_ICON_PATHS[name] || KBV_ICON_PATHS.file} />
    </svg>
  );
}
