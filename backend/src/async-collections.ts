export type AsyncPredicate<T> = (value: T, index: number, items: readonly T[]) => unknown | Promise<unknown>;
export async function asyncFilter<T>(items: readonly T[], predicate: AsyncPredicate<T>, thisArg?: unknown): Promise<T[]> {
  const result: T[] = [];
  for (let index = 0; index < items.length; index++) if (index in items && await predicate.call(thisArg, items[index]!, index, items)) result.push(items[index]!);
  return result;
}
export async function asyncSome<T>(items: readonly T[], predicate: AsyncPredicate<T>, thisArg?: unknown): Promise<boolean> {
  for (let index = 0; index < items.length; index++) if (index in items && await predicate.call(thisArg, items[index]!, index, items)) return true;
  return false;
}
export async function asyncEvery<T>(items: readonly T[], predicate: AsyncPredicate<T>, thisArg?: unknown): Promise<boolean> {
  for (let index = 0; index < items.length; index++) if (index in items && !await predicate.call(thisArg, items[index]!, index, items)) return false;
  return true;
}
export async function asyncFind<T>(items: readonly T[], predicate: AsyncPredicate<T>, thisArg?: unknown): Promise<T | undefined> {
  for (let index = 0; index < items.length; index++) if (await predicate.call(thisArg, items[index]!, index, items)) return items[index];
  return undefined;
}
export async function asyncFindIndex<T>(items: readonly T[], predicate: AsyncPredicate<T>, thisArg?: unknown): Promise<number> {
  for (let index = 0; index < items.length; index++) if (await predicate.call(thisArg, items[index]!, index, items)) return index;
  return -1;
}
export async function asyncForEach<T>(items: readonly T[], callback: AsyncPredicate<T>, thisArg?: unknown): Promise<void> {
  for (let index = 0; index < items.length; index++) if (index in items) await callback.call(thisArg, items[index]!, index, items);
}
