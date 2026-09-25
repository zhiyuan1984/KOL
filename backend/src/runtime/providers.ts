/**
 * Generic credential resolution surface for the configuration-driven Runtime.
 *
 * It deliberately contains no supplier or mailbox lookup. A connector chooses
 * an explicit organization-secret reference or an explicit user-account
 * credential ID; selection is validated in execution.ts for every invocation.
 */
export { resolveAccountHeaders, resolveSecretReference } from "./credentials.js";
