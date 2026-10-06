import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KpiCard } from "./KpiCard";

describe("KpiCard", () => {
  it("renders a non-interactive metric without a button or pressed state", () => {
    const html = renderToStaticMarkup(<KpiCard label="任务总数" value="12" trend={[1, 2, 3]} />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("aria-pressed");
  });

  it("keeps an explicitly actionable metric keyboard-accessible", () => {
    const html = renderToStaticMarkup(<KpiCard label="进行中" value="3" trend={[1, 2, 3]} active onClick={() => undefined} />);
    expect(html).toContain("<button");
    expect(html).toContain('aria-pressed="true"');
  });
});
