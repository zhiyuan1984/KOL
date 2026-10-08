import { expect, it } from "vitest";
import { emptyReviewDefinition, knowledgeReviewDefinition, type ReviewInstance } from "../../shared/review.js";
import { validateDefinition, advanceReview, decideReview } from "../src/approval/review-engine.js";
import { reviewResolver } from "../src/approval/review-resolver.js";
import { reviewProgress } from "../src/approval/review-progress.js";
import { reviewStarters } from "../src/approval/review-starters.js";
import { skillOutputSchema, withNarrative, requiredSkillOutputMissing } from "../src/worker/runner.js";
import { requireTaskDefinition } from "../src/tasks/registry.js";

const now = "2026-10-09T00:00:00Z";
const ctx = { tenant: "a", actor: "employee", admin: false, people: [
  { id: "employee", name: "员工", managerIds: ["reviewer"] },
  { id: "reviewer", name: "负责人", managerIds: [], roles: ["finance"] },
  { id: "handler", name: "办理人", managerIds: [] },
] };
function instance(): ReviewInstance {
  return { id: "i", templateId: "t", templateVersion: 1, version: 1, requester: "employee", title: "申请", definition: emptyReviewDefinition(), values: {}, currentNode: "", status: "reviewing", round: 1, tasks: [], createdAt: now, updatedAt: now };
}
it("offers six independent starter drafts without encoding expense thresholds", () => {
  const starters = reviewStarters();
  expect(starters).toHaveLength(6);
  for (const s of starters) expect(validateDefinition(s.definition).every(issue => issue.path.includes("assignee"))).toBe(true);
  starters[0].definition.name = "modified";
  expect(reviewStarters()[0].definition.name).not.toBe("modified");
});
it("resolves employee choices only within current authority, excluding the requester", () => {
  const node = { ...emptyReviewDefinition().nodes[1], assignee: { kind: "requester_choice" as const, candidates: { kind: "named" as const, userIds: ["employee", "reviewer"] } } };
  expect(reviewResolver(ctx, { review: ["reviewer"] })(node, "employee")).toEqual(["reviewer"]);
  for (const selected of [["employee"], ["outsider"], []]) expect(reviewResolver(ctx, { review: selected })(node, "employee")).toEqual([]);
  expect(reviewResolver({ ...ctx, people: ctx.people.filter(p => p.id !== "reviewer") }, { review: ["reviewer"] })(node, "employee")).toEqual([]);
  node.assignee.candidates.userIds.push("ended-unselected-person");
  expect(reviewResolver(ctx, { review: ["reviewer"] })(node, "employee")).toEqual(["reviewer"]);
});
it("keeps employee choice out of fixed knowledge and handling duties", () => {
  const d = knowledgeReviewDefinition();
  d.nodes[1].assignee = { kind: "requester_choice", candidates: { kind: "manager" } };
  expect(validateDefinition(d).length).toBeGreaterThan(0);
  d.subjectType = undefined; d.nodes[1].type = "handler";
  expect(validateDefinition(d).length).toBeGreaterThan(0);
});
it("separates recorded approval from fulfillment and requires the handler's completion", () => {
  const i = instance();
  i.definition.nodes[1].next = "handler";
  i.definition.nodes.push({ id: "handler", name: "登记办理", type: "handler", assignee: { kind: "named", userIds: ["handler"] }, mode: "single", next: "end" });
  const resolve = reviewResolver(ctx);
  advanceReview(i, "start", resolve, now);
  expect(reviewProgress(i)).toMatchObject({ approval: "pending", fulfillment: "pending" });
  decideReview(i, "reviewer", "approve", "材料核对通过", resolve, now);
  expect(reviewProgress(i)).toMatchObject({ approval: "approved", fulfillment: "handling" });
  i.tasks.find(t => t.userId === "handler")!.status = "completed";
  advanceReview(i, "end", resolve, now);
  expect(reviewProgress(i)).toMatchObject({ approval: "approved", fulfillment: "completed" });
  i.round = 2; i.currentNode = "handler"; i.status = "reviewing";
  expect(reviewProgress(i).approval).toBe("pending");
});
it("does not infer approval from handling when another approval remains", () => {
  const i = instance(); i.currentNode = "handler";
  i.definition.nodes.push({ id: "handler", name: "前置办理", type: "handler", next: "review" });
  i.tasks = [{ nodeId: "old", userId: "reviewer", duty: "review", status: "approved", round: 1 }];
  expect(reviewProgress(i).approval).toBe("pending");
});
it("keeps the AI draft output compatible with the real Codex strict schema", () => {
  const definition = requireTaskDefinition("business_approval");
  const schema = withNarrative(skillOutputSchema("business_approval", definition));
  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;
    expect(value.anyOf).toBeUndefined(); expect(value.oneOf).toBeUndefined(); expect(value.allOf).toBeUndefined();
    if (value.type === "object") { expect(value.additionalProperties).toBe(false); expect(value.required).toEqual(Object.keys(value.properties)); }
    for (const item of Object.values(value)) if (Array.isArray(item)) item.forEach(visit); else visit(item);
  };
  visit(schema);
  expect((schema.properties as any).type.enum).toContain("review_draft");
  expect(requiredSkillOutputMissing("business_approval", definition, [{ type: "review_draft" }])).toBeNull();
});
