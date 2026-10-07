import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("renders a visible, non-scaling trend stroke", () => {
    const html = renderToStaticMarkup(<Sparkline values={[0, 1, 3]} label="采集线索趋势" />);
    expect(html).toContain('aria-label="采集线索趋势"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-width="1.5"');
    expect(html).toContain('vector-effect="non-scaling-stroke"');
    expect(html).toContain('points="0.00,15.00 24.00,10.33 48.00,1.00"');
  });
});
