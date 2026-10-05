import type { ReviewDefinition, ReviewNode } from "../../../shared/review.js";

/** Sequence is derived from executable edges, never from the storage array. */
export function reviewSequence(definition: ReviewDefinition): ReviewNode[] | undefined {
  const { nodes } = definition;
  const starts = nodes.filter(n => n.type === "start");
  if (starts.length !== 1 || nodes.some(n => n.type === "condition") || nodes.filter(n => n.type === "end").length !== 1) return;
  const ordered: ReviewNode[] = [];
  let node: ReviewNode | undefined = starts[0];
  while (node && !ordered.some(n => n.id === node!.id)) {
    ordered.push(node);
    if (node.type === "end") return ordered.length === nodes.length ? ordered : undefined;
    node = nodes.find(n => n.id === node!.next);
  }
}
export function insertReviewStep(d: ReviewDefinition, sourceId: string, edge: "next" | "otherwise", node: ReviewNode): ReviewDefinition {
  const source = d.nodes.find(n => n.id === sourceId);
  if (!source || source.type === "end" || (edge === "otherwise" && source.type !== "condition") || d.nodes.length >= 100) return d;
  const next = source[edge];
  return { ...d, nodes: [
    ...d.nodes.map(n => n.id === sourceId ? { ...n, [edge]: node.id } : n),
    { ...node, next, ...(node.type === "condition" ? { otherwise: next } : {}) },
  ] };
}
export function moveReviewStep(d: ReviewDefinition, id: string, to: number): ReviewDefinition {
  const sequence = reviewSequence(d), node = sequence?.find(n => n.id === id);
  if (!sequence || !node || ["start", "end"].includes(node.type)) return d;
  const ordered = sequence.filter(n => n.id !== id);
  ordered.splice(Math.max(1, Math.min(to, ordered.length - 1)), 0, node);
  return { ...d, nodes: ordered.map((n, i) => ({ ...n, next: ordered[i + 1]?.id })) };
}
export function deleteReviewStep(d: ReviewDefinition, id: string): ReviewDefinition {
  const node = d.nodes.find(n => n.id === id);
  if (!node || ["start", "end"].includes(node.type) || !node.next || node.next === id || (node.type === "condition" && node.next !== node.otherwise)) return d;
  return { ...d, nodes: d.nodes.filter(n => n.id !== id).map(n => ({ ...n,
    ...(n.next === id ? { next: node.next } : {}),
    ...(n.otherwise === id ? { otherwise: node.next } : {}),
  })) };
}
