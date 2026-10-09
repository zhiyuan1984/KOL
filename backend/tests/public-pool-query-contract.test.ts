import { beforeEach, describe, expect, it, vi } from "vitest";

const { postgresQuery, healthQuery, attachLeadAssessments } = vi.hoisted(() => ({
  postgresQuery: vi.fn(),
  healthQuery: vi.fn(async () => ({ rows: [] })),
  attachLeadAssessments: vi.fn(async (rows: unknown[]) => rows),
}));

vi.mock("../src/postgres/pool.js", () => ({ postgresQuery, postgresPool: () => ({ query: healthQuery }) }));
vi.mock("../src/ticket-domain/kol-lead-scoring.js", () => ({ attachLeadAssessments }));

import { parsePoolPageOptions, readPublicPoolPage } from "../src/postgres/public-pool.js";

describe("public pool page contract", () => {
  beforeEach(() => {
    postgresQuery.mockReset();
    healthQuery.mockClear();
    attachLeadAssessments.mockClear();
  });

  it("bounds request cost and rejects unknown SQL sort inputs", () => {
    expect(parsePoolPageOptions({})).toEqual({ query: "", filter: "all", sort: "score-desc", offset: 0, limit: 50 });
    const invalid: Record<string, string>[] = [{ limit: "101" }, { limit: "0" }, { offset: "-1" }, { offset: "1.2" },
      { filter: "private" }, { sort: "id; DROP TABLE users" }, { query: "x".repeat(201) }];
    for (const input of invalid) {
      expect(() => parsePoolPageOptions(input)).toThrow("公海分页或筛选参数无效");
    }
  });

  it("counts the query-scoped authorized set before applying the requested stage filter", async () => {
    postgresQuery.mockResolvedValue([{
      items: [], total: "12", matched: "2", new_count: "3", overdue_count: "1", library_value: null,
    }]);

    const result = await readPublicPoolPage(
      parsePoolPageOptions({ query: "lina", filter: "overdue", sort: "followers-desc", offset: "50", limit: "25" }),
      "company:demo",
      ["lt"],
    );

    const [sql, parameters] = postgresQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("queried AS MATERIALIZED");
    expect(sql).toMatch(/filtered AS MATERIALIZED \(\s*SELECT \* FROM queried WHERE \(\$2='all' OR public_filter=\$2\)/);
    expect(sql).toContain("(SELECT count(*) FROM queried WHERE public_filter='new')");
    expect(sql).toContain("(SELECT count(*) FROM queried WHERE public_filter='overdue')");
    expect(sql).toContain("strpos(lower(concat_ws(");
    expect(sql).toContain("lower($3)) > 0");
    expect(sql).not.toContain("lina");
    expect(parameters).toEqual(["company:demo", "overdue", "lina", 25, 50, ["LT"]]);
    expect(result.page).toEqual({ offset: 50, limit: 25, total: 12, matched: 2, new_count: 3, overdue_count: 1, next_offset: null });
    expect(attachLeadAssessments).toHaveBeenCalledWith([]);
  });
});
