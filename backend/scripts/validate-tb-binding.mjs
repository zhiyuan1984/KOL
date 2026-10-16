import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXPECTED_DICTIONARY_CODES = ["LT", "RO", "PQ"];
const EXPECTED_MAILBOX_CODES = ["LT", "RO"];
function read(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function exactCodes(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

/**
 * The only successful result is an exact, advisory comparison waiver.  It never
 * claims a remote TB mapping exists and it never authorizes a TB remote write.
 * Kept pure so mutation tests never alter the checked-in configuration.
 */
export function evaluateTbBinding({ brands, binding }) {
  const tb = (brands?.brands || []).find((item) => item?.id === "brand:tb");
  const dictionaryCodes = Array.isArray(binding?.remote_dictionary_codes) ? binding.remote_dictionary_codes : [];
  const mailboxCodes = Array.isArray(binding?.remote_mailbox_brand_codes) ? binding.remote_mailbox_brand_codes : [];
  const errors = [];
  if (!tb) errors.push("brand:tb is missing from brand registry");
  if (tb?.code !== "TB" || tb?.status !== "active" || tb?.external_binding !== "business-waived") {
    errors.push("TB registry waiver identity is invalid");
  }
  if (binding?.version !== 1 || binding?.brand !== "brand:tb" || binding?.canonical_code !== "TB") {
    errors.push("TB binding identity is invalid");
  }
  if (binding?.local_registry_status !== "accepted-by-business-waiver"
    || binding?.comparison_status !== "waived"
    || binding?.enforcement !== "advisory") {
    errors.push("TB advisory waiver triplet is invalid");
  }
  if (binding?.write_policy !== "deny_tb_write_until_remote_binding") {
    errors.push("TB write policy must deny writes until remote binding");
  }
  if (binding?.fallback_policy !== "no_fallback_to_other_brand_or_first_mailbox") {
    errors.push("TB fallback policy must forbid cross-brand and first-mailbox fallback");
  }
  if (!exactCodes(dictionaryCodes, EXPECTED_DICTIONARY_CODES) || dictionaryCodes.includes("TB")) {
    errors.push("TB remote dictionary evidence is missing or drifted");
  }
  if (!exactCodes(mailboxCodes, EXPECTED_MAILBOX_CODES) || mailboxCodes.includes("TB")) {
    errors.push("TB remote mailbox evidence is missing or drifted");
  }
  return {
    status: errors.length ? "blocked" : "waived",
    brand: "brand:tb",
    release_comparison: "advisory",
    remote_binding_status: "not_remote_bound",
    write_authorization: "write_denied",
    fallback: "forbidden",
    local_status: tb?.status || null,
    remote_dictionary_codes: dictionaryCodes,
    remote_mailbox_brand_codes: mailboxCodes,
    remote_dictionary_contains_tb: dictionaryCodes.includes("TB"),
    remote_mailbox_contains_tb: mailboxCodes.includes("TB"),
    errors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = evaluateTbBinding({
    brands: read("config/brand-registry.yaml"),
    binding: read("config/tb-binding.yaml"),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exitCode = 1;
}
