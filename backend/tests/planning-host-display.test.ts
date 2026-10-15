import { afterEach, describe, expect, it, vi } from "vitest";
import { withHostPlanningDisplay } from "../src/host/planning-display.js";
import { todayDateStr } from "../src/host/home-board.js";
import { validateTodayBrief } from "../src/host/today-brief.js";
import type { SourceItem, TodayPlanPack } from "../src/host/today-plan-context.js";
import type { Json } from "../src/types.js";

function task(id: string, priority = "normal"): SourceItem {
  return { id: `task:${id}`, kind: "formal_task", title: `正式任务 ${id}`, status: "pending", object_type: "task", person_id: null, work_item_id: id, priority, reason: "未了结正式任务", p0: true };
}
function pack(items: SourceItem[]): TodayPlanPack {
  return { history: { unfinished_tasks: items, previous_brief: null, source_cursor: null }, delta: { added: items, removed: [], unchanged: [] }, now_counts: { unfinished: items.length, discovery_anomalies: 0, failed_runs: 0, follow_plans: 0, correspondence: 0, follow_timers: 0, anomalies: 0 }, stage_counts: { greet: 0, follow: 0, quote: 0, negotiate: 0 }, source_cursor: { cursor_from: null, cursor_to: `src:${items.map(x => x.id).join(",")}`, added: items.map(x => x.id), removed: [], unchanged: [] }, catalog: items };
}
function model(): Json { return { lead: "真实模型的摘要", primary: { verb: "open", label: "打开任务" }, sections: [{ title: "模型解释", body: "按当前输入判断下一步", items: [] }], display_tasks: [], reasoning: ["模型提供的可观察解释"], stats: { unfinished: 999 }, source_cursor: { cursor_to: "model-guessed" } }; }
afterEach(() => { vi.useRealTimers(); });

describe("published planning Host/model responsibility", () => {
  it("accepts the skill-required empty model task array and covers every formal task beyond top-12 candidates", () => {
    const facts = pack(Array.from({ length: 25 }, (_, index) => task(`owned-${index}`)));
    const raw = model(); expect(validateTodayBrief(raw).ok).toBe(true);
    const rendered = withHostPlanningDisplay(raw, facts)!;
    expect(rendered.lead).toBe(raw.lead); expect(rendered.sections).toEqual(raw.sections);
    expect(rendered.reasoning).toEqual(raw.reasoning);
    expect((rendered.display_tasks as Json[]).map(x => x.work_item_id)).toHaveLength(25);
    expect(new Set((rendered.display_tasks as Json[]).map(x => x.work_item_id)).size).toBe(25);
    expect(rendered.source_cursor).toEqual(facts.source_cursor);
    expect((rendered.stats as Json).unfinished).toBe(25);
  });
  it("does not fabricate a model result if no worker brief exists", () => {
    expect(withHostPlanningDisplay(null, pack([task("owned")]))).toBeNull();
    expect(validateTodayBrief({ display_tasks: [] }).ok).toBe(false);
  });
  it("discards invented or other-owner row IDs and keeps Host rank, grouping and exact authorized IDs", () => {
    const raw = model(); raw.display_tasks = [
      { work_item_id: "other-owner", title: "不得展示", why: "外来解释", rank: 1 },
      { work_item_id: "owned-low", title: "合法解释标题", why: "真实模型的合法解释", rank: -50, group: "重要紧急", verb: "open", label: "打开任务" },
    ];
    const rendered = withHostPlanningDisplay(raw, pack([task("owned-low", "low"), task("owned-high", "important_urgent")]))!;
    const rows = rendered.display_tasks as Json[];
    expect(rows.map(x => x.work_item_id)).toEqual(["owned-high", "owned-low"]);
    expect(rows.map(x => x.rank)).toEqual([1, 2]);
    expect(rows.map(x => x.group)).toEqual(["重要紧急", "其他"]);
    expect(rows[1].why).toBe("真实模型的合法解释");
  });
  it("does not expose a send/follow/stage action supplied in candidate wording", () => {
    const raw = model(); raw.display_tasks = [{ work_item_id: "owned", rank: 1, title: "说明", why: "解释", verb: "send", label: "处理" }];
    const row = (withHostPlanningDisplay(raw, pack([task("owned")]))!.display_tasks as Json[])[0];
    expect(row.verb).toBe("open"); expect(row.label).toBe("打开任务");
  });
  it("uses authoritative source counts and keeps an honestly empty authorized catalogue empty", () => {
    const rendered = withHostPlanningDisplay(model(), pack([]))!;
    expect(rendered.display_tasks).toEqual([]); expect((rendered.stats as Json).unfinished).toBe(0);
  });
  it("uses Beijing business date even when a migrated production host runs in UTC", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T17:00:00.000Z"));
    expect(todayDateStr()).toBe("2026-10-16");
  });
});
