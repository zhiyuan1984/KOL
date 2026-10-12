export type MailIconName = "compose" | "tag" | "star" | "read" | "stage" | "search" | "spark" | "close";
const paths: Record<MailIconName, string> = {
  compose: "m4 17 10.5-10.5 3 3L7 20H4v-3ZM14.5 6.5l1.8-1.8a2.1 2.1 0 0 1 3 3l-1.8 1.8",
  tag: "M3 5h8l10 7-10 7H3V5Z M7 9h.01",
  star: "m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3.2 9.6l6.3-.9L12 3Z",
  read: "M4 6h16v13H4V6Zm0 0 8 7 8-7",
  stage: "M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4",
  search: "M17 17 21 21M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0Z",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  close: "m6 6 12 12M18 6 6 18",
};
export function MailIcon({ name, filled = false }: { name: MailIconName; filled?: boolean }) {
  return <svg className={`mail-icon mail-icon-${name}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={paths[name]} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
/** Stable private-label palette; label text stays authoritative, not the color. */
export function mailLabelTone(key: string): string {
  let hash = 0;
  for (const char of key.normalize("NFKC")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ["blue", "green", "rose", "amber", "violet"][hash % 5];
}
