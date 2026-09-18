/**
 * import_creator org-approval gate.
 * Do not invent expense bands or approver names.
 * Published matrix + policies/import_creator.yaml currently have no roster.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const IMPORT_CREATOR_ORG_OBJECT = "discovery_batch";
export const IMPORT_CREATOR_ORG_ACTION = "import_creator";

export type ImportCreatorOrgGate = {
  required: boolean;
  object: string;
  action: string;
  gap?: string;
};

function readPolicy(): { org_approval?: boolean; org_approval_gap?: string } {
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../policies/import_creator.yaml");
    return JSON.parse(fs.readFileSync(file, "utf8")) as { org_approval?: boolean; org_approval_gap?: string };
  } catch {
    return {};
  }
}

/** Returns whether an org ticket must exist before Starry. Missing config → L3-only. */
export function importCreatorOrgApprovalRequired(): ImportCreatorOrgGate {
  const policy = readPolicy();
  if (policy.org_approval === true) {
    return {
      required: true,
      object: IMPORT_CREATOR_ORG_OBJECT,
      action: IMPORT_CREATOR_ORG_ACTION,
    };
  }
  return {
    required: false,
    object: IMPORT_CREATOR_ORG_OBJECT,
    action: IMPORT_CREATOR_ORG_ACTION,
    gap: policy.org_approval_gap
      || "No published approver roster for import_creator. L3-only; frontend must not compute a chain.",
  };
}
