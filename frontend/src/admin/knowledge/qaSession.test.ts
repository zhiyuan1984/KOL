import { describe, expect, it } from "vitest";
import type { QaMaintenanceResult, QaScope } from "../../../../shared/knowledge-qa.js";
import {
  applyQaMaintenance,
  createQaSession,
  failQaMaintenance,
  planQaMaintenance,
  qaR1Fold,
  qaRecentTurns,
  qaScopeKey,
  qaSearchContext,
  type QaSession,
} from "./qaSession";

const scope: QaScope = { base_id: "base-a" };
const citation = { document: "规格书", page: 2, document_id: "doc-a", title: "规格书", engine_doc_id: "engine-a" };

function complete(session: QaSession, query: string, answer: string, entities = ["实体"]): QaSession {
  const plan = planQaMaintenance(session, scope, { query, answer, citations: [citation] });
  const result: QaMaintenanceResult = {
    entities,
    history_summary: plan.summaryBeforeMaintenance,
    status: "ready",
    compressed: false,
    summary_truncated: false,
  };
  return applyQaMaintenance(session, plan, result);
}

describe("qaSession", () => {
  it("范围键只由 base、去重排序后的 docs 和有效 include_pending 决定", () => {
    expect(qaScopeKey({ base_id: "a", doc_ids: ["b", "a", "b"], include_pending: true }))
      .toBe(qaScopeKey({ base_id: "a", doc_ids: ["a", "b"], include_pending: true }));
    expect(qaScopeKey({ base_id: "a", doc_ids: ["a", "b"], include_pending: false }))
      .not.toBe(qaScopeKey({ base_id: "a", doc_ids: ["a", "b"], include_pending: true }));
  });

  it("R1 只折叠问句、回答首句和维护得到的实体", () => {
    expect(qaR1Fold({ query: "它支持什么？", answer: "支持 48V。后面不应进入摘要。", entities: ["产品 A", "48V"] }))
      .toBe("问：它支持什么？\n答：支持 48V。\n实体：产品 A、48V");
  });

  it("三轮中首轮传 null，第二轮折叠首轮，第三轮携带首轮摘要和第二轮 last_turn", () => {
    let session = createQaSession();
    expect(qaSearchContext(session, scope)).toMatchObject({ last_turn: null, history_summary: "" });

    session = complete(session, "第一问", "第一答。第二句。", ["A"]);
    const second = qaSearchContext(session, scope);
    expect(second.history_summary).toBe("");
    expect(second.last_turn).toMatchObject({ query: "第一问", answer: "第一答。第二句。", entities: ["A"] });

    session = complete(session, "第二问", "第二答。", ["B"]);
    const third = qaSearchContext(session, scope);
    expect(third.history_summary).toContain("问：第一问\n答：第一答。\n实体：A");
    expect(third.last_turn).toMatchObject({ query: "第二问", answer: "第二答。", entities: ["B"] });

    session = complete(session, "第三问", "第三答。", ["C"]);
    expect(session.turns.map((turn) => turn.seq)).toEqual([1, 2, 3]);
  });

  it("同一维护计划的重放不会重复追加 turn", () => {
    const session = createQaSession();
    const plan = planQaMaintenance(session, scope, { query: "问题", answer: "回答", citations: [citation] });
    const result: QaMaintenanceResult = {
      entities: ["实体"], history_summary: "", status: "ready", compressed: false, summary_truncated: false,
    };
    const once = applyQaMaintenance(session, plan, result);
    const twice = applyQaMaintenance(once, plan, result);
    expect(twice).toBe(once);
    expect(twice.turns).toHaveLength(1);
  });

  it("摘要恰好 1500 不压缩，1501 压缩；第 8 次不压缩、第 9 次压缩", () => {
    const last = {
      seq: 1,
      query: "q",
      answer: "a",
      entities: [],
      citations: [],
      effective_query: "q",
    };
    const atLimit: QaSession = { summary: "x".repeat(1500), foldedThroughSeq: 1, turnsSinceCompression: 0, turns: [last] };
    const overLimit: QaSession = { ...atLimit, summary: "x".repeat(1501) };
    expect(planQaMaintenance(atLimit, scope, { query: "next", answer: "a", citations: [] }).compress).toBe(false);
    expect(planQaMaintenance(overLimit, scope, { query: "next", answer: "a", citations: [] }).compress).toBe(true);

    const eighth: QaSession = { summary: "", foldedThroughSeq: 0, turnsSinceCompression: 7, turns: [last] };
    const ninth: QaSession = { ...eighth, turnsSinceCompression: 8 };
    expect(planQaMaintenance(eighth, scope, { query: "next", answer: "a", citations: [] }).compress).toBe(false);
    expect(planQaMaintenance(ninth, scope, { query: "next", answer: "a", citations: [] }).compress).toBe(true);
  });

  it("压缩失败保留完整明细并以最新 1500 字符摘要降级", () => {
    const prior = complete(createQaSession(), "旧问题", "旧回答", ["旧实体"]);
    const session: QaSession = { ...prior, summary: `开头${"x".repeat(1598)}`, turnsSinceCompression: 8 };
    const plan = planQaMaintenance(session, scope, { query: "新问题", answer: "完整新回答", citations: [citation] });
    expect(plan.compress).toBe(true);
    const fallback = failQaMaintenance(session, plan);
    expect(fallback.degradedSummary).toBe(true);
    expect(fallback.session.summary).toHaveLength(1500);
    expect(fallback.session.summary).toBe(plan.summaryBeforeMaintenance.slice(-1500));
    expect(fallback.session.turns.at(-1)?.answer).toBe("完整新回答");
  });

  it("维护请求保留完整 answer 以抽实体，而下一轮上下文只截断 answer 并保留实体和引用", () => {
    const fullAnswer = `${"A".repeat(2000)}尾部实体`;
    const plan = planQaMaintenance(createQaSession(), scope, {
      query: "问题",
      answer: fullAnswer,
      citations: [citation],
      effectiveQuery: "实际问题",
    });
    expect(plan.input.turn.answer).toBe(fullAnswer);
    expect(plan.input.turn.entities).toEqual([]);
    expect(plan.input.effective_query).toBe("实际问题");

    const session = applyQaMaintenance(createQaSession(), plan, {
      entities: ["尾部实体"], history_summary: "", status: "ready", compressed: false, summary_truncated: false,
    });
    const context = qaSearchContext(session, scope);
    expect(context.last_turn?.answer).toHaveLength(2000);
    expect(context.last_turn?.entities).toEqual(["尾部实体"]);
    expect(context.last_turn?.citations).toEqual([citation]);
  });

  it("会话明细窗口始终只保留最近 8 轮，摘要仍在每轮维护时折叠", () => {
    let session = createQaSession();
    for (let index = 1; index <= 9; index += 1) {
      session = complete(session, `问题${index}`, `回答${index}`, [`实体${index}`]);
    }
    expect(session.turns).toHaveLength(8);
    expect(session.turns.map((turn) => turn.seq)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(qaRecentTurns(session).map((turn) => turn.seq)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

it("窗口已淘汰的旧维护计划不能倒退轮次或覆盖摘要", () => {
  const initial = createQaSession();
  const stale = planQaMaintenance(initial, scope, { query: "旧问题", answer: "旧答案", citations: [] });
  let latest = initial;
  for (let i = 0; i < 10; i++) latest = complete(latest, `问题${i}`, `答案${i}。`);
  const result: QaMaintenanceResult = { entities: ["旧实体"], history_summary: "不应采用", status: "ready", compressed: false, summary_truncated: false };
  expect(applyQaMaintenance(latest, stale, result)).toBe(latest);
  expect(failQaMaintenance(latest, stale).session).toBe(latest);
});
it("实体原文中的内部空格不可被前端重新标准化", () => {
  const session = complete(createQaSession(), "q", "LiTime  12V 100Ah", ["LiTime  12V 100Ah"]);
  expect(qaSearchContext(session, scope).last_turn?.entities).toEqual(["LiTime  12V 100Ah"]);
  expect(qaR1Fold(session.turns[0])).toContain("实体：LiTime  12V 100Ah");
});
