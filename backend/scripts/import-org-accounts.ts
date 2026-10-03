/** Dry run by default. Run --apply against the configured application database after org-registry-replay. */
import { audit } from "../src/db.js";
import { importOrganizationAccounts } from "../src/runtime/org-account-import.js";

const apply = process.argv.includes("--apply");
const actions = importOrganizationAccounts(apply);
for (const row of actions) console.log(`${row.action}\t${row.person_ref}\t${row.name}${row.reason ? `\t${row.reason}` : ""}`);
const counts = Object.fromEntries(["create", "link", "update", "skip"].map((kind) => [kind, actions.filter((row) => row.action === kind).length]));
console.log(JSON.stringify({ applied: apply, counts }));
if (apply) audit("cli:import-org-accounts", "org_accounts.imported", { counts, person_refs: actions.filter((row) => row.action !== "skip").map((row) => row.person_ref) });
if (actions.some((row) => row.action === "skip")) process.exitCode = 1;
