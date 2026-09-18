import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKBENCH = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./Workbench.tsx"),
  "utf8",
);

function todayNavOrder(source: string): string[] {
  const start = source.indexOf('aria-label="今日"');
  const end = source.indexOf('aria-label="数字员工"');
  const cluster = start >= 0 && end > start ? source.slice(start, end) : "";
  return [...cluster.matchAll(/data-nav="([^"]+)"/g)].map((match) => match[1]);
}

describe("今日 sidebar IA", () => {
  it("locks funnel data-nav order", () => {
    expect(todayNavOrder(WORKBENCH)).toEqual([
      "new-task",
      "running",
      "discovery",
      "pool",
      "followed",
      "cron",
      "mail",
    ]);
  });

  it("exposes AI发现 as a memory sidebar entry, not a Home top-bar pool tab", () => {
    expect(WORKBENCH).toContain('data-nav="discovery"');
    expect(WORKBENCH).toContain('data-home-entry="existing-discovery"');
    expect(WORKBENCH).toContain('to="/?tab=discovery"');
    expect(WORKBENCH).toContain('to="/?tab=pool"');
    expect(WORKBENCH).toContain("homeMode === \"discovery\"");
    expect(WORKBENCH).not.toMatch(/HOME_MODES[\s\S]*pool/);
  });
});
