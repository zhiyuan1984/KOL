import { describe, expect, it } from "vitest";
// @ts-ignore The production validator is intentionally a dependency-free ESM CLI.
import { evaluateTbBinding } from "../scripts/validate-tb-binding.mjs";

type Binding = {
  version: number;
  brand: string;
  canonical_code: string;
  local_registry_status: string;
  remote_dictionary_codes: string[];
  remote_mailbox_brand_codes: string[];
  comparison_status: string;
  enforcement: string;
  write_policy: string;
  fallback_policy: string;
};

const registry = {
  version: 1,
  brands: [
    { id: "brand:lt", code: "LT", status: "active" },
    { id: "brand:ro", code: "RO", status: "active" },
    { id: "brand:pq", code: "PQ", status: "active" },
    { id: "brand:tb", code: "TB", status: "active", external_binding: "business-waived" },
  ],
};

const binding: Binding = {
  version: 1,
  brand: "brand:tb",
  canonical_code: "TB",
  local_registry_status: "accepted-by-business-waiver",
  remote_dictionary_codes: ["LT", "RO", "PQ"],
  remote_mailbox_brand_codes: ["LT", "RO"],
  comparison_status: "waived",
  enforcement: "advisory",
  write_policy: "deny_tb_write_until_remote_binding",
  fallback_policy: "no_fallback_to_other_brand_or_first_mailbox",
};

type Candidate = { brands: typeof registry; binding: Binding };

function result(mutator: (candidate: Candidate) => void = () => {}) {
  const brands = structuredClone(registry);
  const candidate = structuredClone(binding);
  mutator({ brands, binding: candidate });
  return evaluateTbBinding({ brands, binding: candidate }) as {
    status: string;
    release_comparison: string;
    remote_binding_status: string;
    write_authorization: string;
    fallback: string;
    remote_dictionary_contains_tb: boolean;
    remote_mailbox_contains_tb: boolean;
    errors: string[];
  };
}

describe("TB binding waiver validator", () => {
  it("reports the accepted waiver as advisory-only, never valid or remote-bound", () => {
    expect(result()).toMatchObject({
      status: "waived",
      release_comparison: "advisory",
      remote_binding_status: "not_remote_bound",
      write_authorization: "write_denied",
      fallback: "forbidden",
      remote_dictionary_contains_tb: false,
      remote_mailbox_contains_tb: false,
      errors: [],
    });
  });

  it.each([
    ["local registry waiver", (candidate: Candidate) => { candidate.binding.local_registry_status = "active"; }],
    ["comparison waiver", (candidate: Candidate) => { candidate.binding.comparison_status = "required"; }],
    ["advisory marker", (candidate: Candidate) => { candidate.binding.enforcement = "enforced"; }],
    ["registry external binding", (candidate: Candidate) => { candidate.brands.brands.find((brand) => brand.id === "brand:tb")!.external_binding = "remote-bound"; }],
    ["write deny", (candidate: Candidate) => { candidate.binding.write_policy = "allow"; }],
    ["fallback deny", (candidate: Candidate) => { candidate.binding.fallback_policy = "allow_first_mailbox"; }],
    ["dictionary evidence", (candidate: Candidate) => { candidate.binding.remote_dictionary_codes.push("TB"); }],
    ["mailbox evidence", (candidate: Candidate) => { candidate.binding.remote_mailbox_brand_codes.push("TB"); }],
    ["remote dictionary drift", (candidate: Candidate) => { candidate.binding.remote_dictionary_codes = ["LT", "RO"]; }],
    ["remote mailbox drift", (candidate: Candidate) => { candidate.binding.remote_mailbox_brand_codes = ["LT"]; }],
  ])("blocks %s mutation", (_label, mutate) => {
    const checked = result(mutate);
    expect(checked.status).toBe("blocked");
    expect(checked.write_authorization).toBe("write_denied");
    expect(checked.remote_binding_status).toBe("not_remote_bound");
    expect(checked.errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(checked)).not.toContain('"valid"');
  });
});
