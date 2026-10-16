import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TB_CODE = "TB";
const EXPECTED_DICTIONARY_CODES = ["LT", "RO", "PQ"];
const EXPECTED_MAILBOX_CODES = ["LT", "RO"];

type JsonRecord = Record<string, unknown>;

type TbBindingPolicy = {
  brand: "TB";
  remote_bound: false;
  write_allowed: false;
  fallback_allowed: false;
  configuration_valid: boolean;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function sameStrings(value: unknown, expected: string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function includesTb(value: unknown): boolean {
  return Array.isArray(value) && value.includes(TB_CODE);
}

function readConfig(relativePath: string): JsonRecord {
  return record(JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8")));
}

/** Convert only an explicit stored brand identifier/code; never infer a brand from an email address. */
export function canonicalBrandCode(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^brand:/i, "").trim().toUpperCase();
}

export function sameBrand(left: unknown, right: unknown): boolean {
  const leftCode = canonicalBrandCode(left);
  const rightCode = canonicalBrandCode(right);
  return Boolean(leftCode && rightCode && leftCode === rightCode);
}

/**
 * Read the repository's current TB policy on every decision.  The advisory comparison
 * field is intentionally not a write grant: only the exact pre-approved waiver shape
 * is recognized, and it still returns write_allowed=false.
 */
export function currentTbBindingPolicy(): TbBindingPolicy {
  try {
    const binding = readConfig("config/tb-binding.yaml");
    const registry = readConfig("config/brand-registry.yaml");
    const tb = (Array.isArray(registry.brands) ? registry.brands : [])
      .map(record)
      .find((brand) => brand.id === "brand:tb");
    const valid = Boolean(
      binding.version === 1
      && binding.brand === "brand:tb"
      && binding.canonical_code === TB_CODE
      && binding.local_registry_status === "accepted-by-business-waiver"
      && binding.comparison_status === "waived"
      && binding.enforcement === "advisory"
      && binding.write_policy === "deny_tb_write_until_remote_binding"
      && binding.fallback_policy === "no_fallback_to_other_brand_or_first_mailbox"
      && sameStrings(binding.remote_dictionary_codes, EXPECTED_DICTIONARY_CODES)
      && sameStrings(binding.remote_mailbox_brand_codes, EXPECTED_MAILBOX_CODES)
      && !includesTb(binding.remote_dictionary_codes)
      && !includesTb(binding.remote_mailbox_brand_codes)
      && tb?.id === "brand:tb"
      && tb.code === TB_CODE
      && tb.status === "active"
      && tb.external_binding === "business-waived",
    );
    return {
      brand: TB_CODE,
      remote_bound: false,
      write_allowed: false,
      fallback_allowed: false,
      configuration_valid: valid,
    };
  } catch {
    // Missing/unparseable configuration may never permit a TB remote write or fallback.
    return {
      brand: TB_CODE,
      remote_bound: false,
      write_allowed: false,
      fallback_allowed: false,
      configuration_valid: false,
    };
  }
}

/** All known non-TB brands keep their existing policy; TB is always fail-closed. */
export function remoteWriteDecision(brand: unknown): TbBindingPolicy | { brand: string; remote_bound: true; write_allowed: true; fallback_allowed: false; configuration_valid: true } {
  const code = canonicalBrandCode(brand);
  if (code === TB_CODE) return currentTbBindingPolicy();
  return {
    brand: code,
    remote_bound: true,
    write_allowed: true,
    fallback_allowed: false,
    configuration_valid: true,
  };
}
