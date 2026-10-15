/**
 * Compatibility export for callers that still use the historical module path.
 * The implementation is PostgreSQL-only and requires a caller-owned PoolClient.
 */
export { PostgresReviewService as ReviewService } from "./review-postgres-service.js";
export type { ReviewContext } from "./review-context.js";
