import { describe, expect, it } from "vitest";
import { emptyReviewDefinition, type ReviewNode } from "../../shared/review.js";
import { deleteReviewStep, insertReviewStep, moveReviewStep, reviewSequence } from "../../frontend/src/reviews/reviewGraph.js";
import { validateDefinition } from "../src/approval/review-engine.js";

const review: ReviewNode = { id: "second", name: "第二次评审", type: "review", assignee: { kind: "manager" }, mode: "single", reject: "any_reject" };
describe("review graph editing preserves executable paths", () => {
  it("derives order from edges even when storage order is different, and fixes both sides when moving/deleting", () => {
    const inserted = insertReviewStep(emptyReviewDefinition(), "start", "next", review);
    expect(reviewSequence(inserted)?.map(n => n.id)).toEqual(["start", "second", "review", "end"]);
    const moved = moveReviewStep(inserted, "second", 2);
    expect(reviewSequence(moved)?.map(n => n.id)).toEqual(["start", "review", "second", "end"]);
    expect(validateDefinition(moved)).toEqual([]);
    const deleted = deleteReviewStep(moved, "second");
    expect(deleted.nodes.find(n => n.id === "review")?.next).toBe("end");
    expect(validateDefinition(deleted)).toEqual([]);
    expect(moveReviewStep(inserted, "start", 2)).toBe(inserted);
    expect(deleteReviewStep(inserted, "end")).toBe(inserted);
  });
  it("inserts on only the chosen branch and reconnects shared incoming edges on deletion", () => {
    const branch = insertReviewStep(emptyReviewDefinition(), "start", "next", { id: "branch", name: "分支", type: "condition", condition: { field: "text", op: "eq", value: "A" } });
    const selected = insertReviewStep(branch, "branch", "otherwise", review);
    expect(selected.nodes.find(n => n.id === "branch")).toMatchObject({ next: "review", otherwise: "second" });
    expect(reviewSequence(selected)).toBeUndefined();
    expect(moveReviewStep(selected, "second", 1)).toBe(selected);
    expect(deleteReviewStep(selected, "branch")).toBe(selected);
    const shared = deleteReviewStep(branch, "review");
    expect(shared.nodes.find(n => n.id === "branch")).toMatchObject({ next: "end", otherwise: "end" });
  });
  it("does not normalize disconnected legacy graphs into a sequence", () => {
    const d = emptyReviewDefinition();
    d.nodes.push({ ...review, next: "end" });
    expect(reviewSequence(d)).toBeUndefined();
    expect(moveReviewStep(d, "second", 1)).toBe(d);
  });
});
