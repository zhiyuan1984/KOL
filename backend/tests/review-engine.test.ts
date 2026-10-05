import { describe, expect, it } from "vitest";
import {
  emptyReviewDefinition,
  type ReviewInstance,
  type ReviewDefinition,
} from "../../shared/review.js";
import {
  advanceReview,
  decideReview,
  validateDefinition,
  validatePublicationNames,
  validateValues,
} from "../src/approval/review-engine.js";
const now = "2026-10-04T00:00:00.000Z";
const resolve = () => ["r1", "r2"];
it("allows draft placeholders but requires business step names for publication", () => {
  const definition = emptyReviewDefinition();
  definition.nodes[1].name = "新评审节点";
  expect(validateDefinition(definition)).toEqual([]);
  expect(validatePublicationNames(definition)).toEqual([{ path: "nodes.1.name", message: expect.stringContaining("业务名称") }]);
  definition.nodes[1].name = "负责人评审";
  expect(validatePublicationNames(definition)).toEqual([]);
});
function instance(
  mode: "single" | "all" | "any" | "sequential" = "all",
): ReviewInstance {
  const definition = emptyReviewDefinition();
  Object.assign(definition.nodes[1], {
    mode,
    assignee: {
      kind: "named",
      userIds: mode === "single" ? ["r1"] : ["r1", "r2"],
    },
  });
  return {
    id: "i",
    templateId: "t",
    templateVersion: 1,
    version: 1,
    requester: "employee",
    title: "内容评审",
    definition,
    values: {},
    currentNode: "",
    status: "reviewing",
    tasks: [],
    createdAt: now,
    updatedAt: now,
  };
}
describe("generic review graph and forms", () => {
  it("supports non-expense definitions with no amount or currency", () =>
    expect(validateDefinition(emptyReviewDefinition())).toEqual([]));
  it.each(["cycle", "missing", "empty", "unreachable", "bypass"])(
    "rejects %s graphs",
    (kind) => {
      const d = emptyReviewDefinition();
      if (kind === "cycle") d.nodes[1].next = "review";
      if (kind === "missing") d.nodes[1].next = "unknown";
      if (kind === "empty") d.nodes = [];
      if (kind === "unreachable")
        d.nodes.push({ id: "extra", name: "无法到达", type: "end" });
      if (kind === "bypass") {
        d.nodes[0].next = "end";
      }
      expect(validateDefinition(d).length).toBeGreaterThan(0);
    },
  );
  it("rejects execution configuration and unsupported field types", () => {
    const d = emptyReviewDefinition() as any;
    d.nodes[1].url = "https://outside.invalid";
    d.fields = [
      { id: "file", label: "未支持字段", type: "script", required: false },
    ];
    expect(validateDefinition(d)).toHaveLength(2);
  });
  it("rejects duplicate fields and prototype keys", () => {
    const d = emptyReviewDefinition();
    d.fields = [
      { id: "constructor", label: "值", type: "text", required: true },
    ];
    expect(validateDefinition(d).length).toBeGreaterThan(0);
  });
  it("validates required, actual dates, numeric types, options and undeclared keys", () => {
    const d = emptyReviewDefinition();
    d.fields = [
      { id: "title", label: "标题", type: "text", required: true },
      { id: "day", label: "日期", type: "date", required: false },
      { id: "score", label: "评分", type: "number", required: false },
      {
        id: "tags",
        label: "标签",
        type: "multiselect",
        required: false,
        options: ["a"],
      },
    ];
    expect(
      validateValues(d, {
        day: "2026-02-30",
        score: "10",
        tags: ["a", "a"],
        amount_cny: 0,
      }),
    ).toHaveLength(5);
    expect(
      validateValues(d, {
        title: "稿件",
        day: "2026-10-04",
        score: 10,
        tags: ["a"],
      }),
    ).toEqual([]);
  });
  it("blocks missing optional condition values rather than falling through", () => {
    const i = instance();
    i.definition.nodes[0].next = "c";
    i.definition.nodes.push({
      id: "c",
      name: "条件",
      type: "condition",
      next: "review",
      otherwise: "review",
      condition: { field: "score", op: "gt", value: 3 },
    });
    advanceReview(i, "start", resolve, now);
    expect(i.status).toBe("blocked");
    expect(i.tasks).toEqual([]);
  });
  it("routes by the submitted generic field", () => {
    const i = instance();
    i.values = { score: 8 };
    i.definition.nodes[0].next = "c";
    i.definition.nodes.push(
      {
        id: "c",
        name: "条件",
        type: "condition",
        next: "review",
        otherwise: "other",
        condition: { field: "score", op: "gt", value: 3 },
      },
      { ...i.definition.nodes[1], id: "other" },
    );
    advanceReview(i, "start", resolve, now);
    expect(i.currentNode).toBe("review");
  });
});
describe("node decisions", () => {
  it("all-sign needs all positive decisions", () => {
    const i = instance();
    advanceReview(i, "start", resolve, now);
    decideReview(i, "r1", "approve", "", resolve, now);
    expect(i.status).toBe("reviewing");
    decideReview(i, "r2", "approve", "", resolve, now);
    expect(i.status).toBe("approved");
  });
  it("any-sign cancels remaining tasks after one approval", () => {
    const i = instance("any");
    advanceReview(i, "start", resolve, now);
    decideReview(i, "r1", "approve", "", resolve, now);
    expect(i.status).toBe("approved");
    expect(i.tasks[1].status).toBe("cancelled");
  });
  it("any-sign all-reject waits for all rejections", () => {
    const i = instance("any");
    i.definition.nodes[1].reject = "all_reject";
    advanceReview(i, "start", resolve, now);
    decideReview(i, "r1", "reject", "不通过", resolve, now);
    expect(i.status).toBe("reviewing");
    decideReview(i, "r2", "reject", "不通过", resolve, now);
    expect(i.status).toBe("rejected");
  });
  it("sequential reviewers cannot act early and get a new deadline", () => {
    const i = instance("sequential");
    i.definition.nodes[1].timeoutHours = 1;
    advanceReview(i, "start", resolve, now);
    expect(() => decideReview(i, "r2", "approve", "", resolve, now)).toThrow();
    const later = "2026-10-04T02:00:00.000Z";
    decideReview(i, "r1", "approve", "", resolve, later);
    expect(i.tasks[1].status).toBe("pending");
    expect(i.tasks[1].dueAt).toBe("2026-10-04T03:00:00.000Z");
  });
  it("reject terminates and cancels outstanding tasks", () => {
    const i = instance();
    advanceReview(i, "start", resolve, now);
    decideReview(i, "r1", "reject", "材料不足", resolve, now);
    expect(i.status).toBe("rejected");
    expect(i.tasks[1].status).toBe("cancelled");
  });
  it("does not allow self approval or unresolved people", () => {
    for (const resolver of [() => [], () => ["employee"]]) {
      const i = instance();
      advanceReview(i, "start", resolver, now);
      expect(i.status).toBe("blocked");
    }
  });
  it("rechecks current assignee qualification", () => {
    const i = instance();
    advanceReview(i, "start", resolve, now);
    expect(() => decideReview(i, "r1", "approve", "", () => [], now)).toThrow();
    expect(i.tasks[0].status).toBe("pending");
  });
  it("cannot reuse a completed task", () => {
    const i = instance();
    advanceReview(i, "start", resolve, now);
    decideReview(i, "r1", "approve", "", resolve, now);
    expect(() => decideReview(i, "r1", "approve", "", resolve, now)).toThrow();
  });
});
