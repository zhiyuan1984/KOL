/** 知识页共用内联图标（描边路径口径与 space-3 原型一致；尺寸与描边由 .kbv svg 样式决定）。 */
const KBV_ICON_PATHS: Record<string, string> = {
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6",
  file: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
  mail: "M3 5h18v14H3z M3 5l9 8 9-8",
  close: "M6 6l12 12 M18 6L6 18",
  plus: "M12 5v14 M5 12h14",
  book: "M3 5h7l2 2 2-2h7v15h-7l-2 1-2-1H3z M12 7v14",
  back: "M15 5l-7 7 7 7",
  chevron: "M6 9l6 6 6-6",
  family: "M9 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0 M6 21v-3a6 6 0 0 1 12 0v3 M3 9a2 2 0 1 0 4 0 2 2 0 0 0-4 0 M2 18v-2a4 4 0 0 1 3-4 M17 9a2 2 0 1 0 4 0 2 2 0 0 0-4 0 M22 18v-2a4 4 0 0 0-3-4",
  layers: "M3 7l9-4 9 4-9 4z M3 12l9 4 9-4 M3 17l9 4 9-4",
  tag: "M3 3h8l10 10-8 8L3 11z M7 7h.01",
  hierarchy: "M9 3h6v5H9z M3 16h6v5H3z M15 16h6v5h-6z M12 8v4 M6 16v-4h12v4",
  status: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M8 12l3 3 5-6",
};

export default function KbvIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={KBV_ICON_PATHS[name] || KBV_ICON_PATHS.file} />
    </svg>
  );
}
