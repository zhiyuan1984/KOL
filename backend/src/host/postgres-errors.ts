function sqlState(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
}
export function isPostgresForeignKeyError(error: unknown): boolean { return sqlState(error) === "23503"; }
/** Background completion may race an intentionally closed independent test pool. */
export function isPostgresClosedError(error: unknown): boolean {
  return ["57P01", "57P02", "57P03", "08003", "08006"].includes(sqlState(error));
}
