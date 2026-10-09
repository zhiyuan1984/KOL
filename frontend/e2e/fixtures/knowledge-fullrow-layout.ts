import { expect, type Locator } from '@playwright/test';

/** Actual element geometry, not a display:contents wrapper's empty bounding box. */
export async function assertFullRowLayout(filters: Locator) {
  const rows = await filters.locator('.knowledge-filter-row').evaluateAll(nodes => nodes.map(row => {
    const label = row.querySelector('.kbv-scope-name')!.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    const items = [...row.querySelector('.knowledge-filter-options')!.children].map(node => {
      const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, height: b.height };
    }).filter(b => b.height > 0);
    return { label: label.width, labelX: label.x, labelY: label.y, labelRight: label.right,
      left: bounds.left, right: bounds.right, gap: parseFloat(getComputedStyle(row).columnGap), items };
  }));
  let continuationLines = 0;
  for (const row of rows) {
    expect(row.items.length).toBeGreaterThan(0);
    expect(Math.abs(row.labelX - row.left)).toBeLessThan(1);
    const first = row.items[0];
    if (Math.abs(first.y - row.labelY) < 1) {
      expect(Math.abs(first.x - row.labelRight - row.gap)).toBeLessThan(1);
    } else {
      expect(Math.abs(first.x - row.left)).toBeLessThan(1);
    }
    let lastY = row.labelY;
    for (const item of row.items) {
      expect(item.x).toBeGreaterThanOrEqual(row.left - 1);
      expect(item.right).toBeLessThanOrEqual(row.right + 1);
      if (item.y > lastY + 1) {
        expect(Math.abs(item.x - row.left), 'every continuation starts at the row left edge').toBeLessThan(1);
        continuationLines += 1;
      }
      lastY = item.y;
    }
  }
  return { continuationLines, rowCount: rows.length };
}
