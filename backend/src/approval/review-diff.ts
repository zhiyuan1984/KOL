import type { ReviewDefinition } from "../../../shared/review.js";
export type ReviewChange = { path: string; before: unknown; after: unknown };
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
/** Match fields and nodes by stable IDs; array order is reported independently. */
export function definitionDiff(
  before: ReviewDefinition | undefined,
  after: ReviewDefinition,
): ReviewChange[] {
  const changes: ReviewChange[] = [];
  const add = (path: string, a: unknown, b: unknown) => {
    if (stable(a) !== stable(b))
      changes.push({ path, before: a ?? null, after: b ?? null });
  };
  for (const key of ["name", "description"] as const)
    add(key, before?.[key], after[key]);
  for (const key of ["fields", "nodes"] as const) {
    const a = new Map((before?.[key] || []).map((x) => [x.id, x]));
    const b = new Map(after[key].map((x) => [x.id, x]));
    for (const id of new Set([...a.keys(), ...b.keys()]))
      add(`${key}.${id}`, a.get(id), b.get(id));
    add(
      `${key}.order`,
      before?.[key].map((x) => x.id),
      after[key].map((x) => x.id),
    );
  }
  return changes;
}
