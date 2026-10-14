import { postgresDb } from "../postgres/access.js";
/**
 * 请求路径只验证由 PostgreSQL migration 创建的运行时身份表；绝不在请求中执行 DDL。
 * 缺表意味着部署遗漏 migration，应显式失败而不是静默创建不同版本的 schema。
 */
export async function requireRuntimeIdentityTables(scope: string, tables: readonly string[]): Promise<void> {
    const missing = await postgresDb().many<{
        name: string;
    }>("SELECT expected.name FROM unnest($1::text[]) AS expected(name) WHERE to_regclass('public.' || expected.name) IS NULL ORDER BY expected.name", [...tables]);
    if (missing.length) {
        throw new Error(`PostgreSQL migration missing for ${scope}: ${missing.map((row) => row.name).join(", ")}`);
    }
}
export function pgPlaceholders(count: number, start = 1): string {
    if (!Number.isInteger(count) || count < 0 || !Number.isInteger(start) || start < 1)
        throw new Error("invalid PostgreSQL placeholder range");
    return Array.from({ length: count }, (_, index) => `$${start + index}`).join(", ");
}
