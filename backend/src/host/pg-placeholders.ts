/** Native PostgreSQL positional placeholders for static, code-owned SQL fragments. */
export function pgPlaceholders(count: number, startAt = 1): string {
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(startAt) || startAt < 1)
        throw new Error("invalid PostgreSQL placeholder range");
    return Array.from({ length: count }, (_, index) => `$${startAt + index}`).join(",");
}
/**
 * Assignments are limited to code-owned column identifiers. Values remain bound
 * separately through PgRepository; no request-controlled identifier is accepted.
 */
export function pgAssignments(columns: readonly string[], startAt = 1): string {
    if (!Number.isSafeInteger(startAt) || startAt < 1 || columns.some((column) => !/^[a-z_][a-z0-9_]*$/.test(column)))
        throw new Error("invalid PostgreSQL assignment column");
    return columns.map((column, index) => `${column}=$${startAt + index}`).join(", ");
}
