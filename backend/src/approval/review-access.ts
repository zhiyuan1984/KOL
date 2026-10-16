/**
 * PostgreSQL-only review access surface.
 *
 * Context construction is pure; every database lookup is performed by
 * review-postgres-access with a caller-owned PoolClient. The historical
 * synchronous connection API is deliberately not retained.
 */
export {
  buildReviewContext,
  buildReviewOrganization,
  type ReviewContext,
  type ReviewMembership,
  type ReviewOrganizationContext,
} from "./review-context.js";
export {
  postgresReviewCompanies as reviewCompaniesForActor,
  postgresReviewContext as reviewContextForActor,
} from "./review-postgres-access.js";
