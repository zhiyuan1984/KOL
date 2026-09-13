import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
function read(relative) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

const brands = read("config/brand-registry.yaml");
const binding = read("config/tb-binding.yaml");
const tb = (brands.brands || []).find((item) => item.id === "brand:tb");
const errors = [];
if (!tb) errors.push("brand:tb is missing from brand registry");
if (binding.brand !== "brand:tb" || binding.canonical_code !== "TB") errors.push("TB binding identity is invalid");
if (!(binding.remote_dictionary_codes || []).includes("TB")) errors.push("remote brand dictionary does not contain TB");
if (!(binding.remote_mailbox_brand_codes || []).includes("TB")) errors.push("remote mailbox data does not contain TB");
if (binding.write_policy !== "deny_tb_write_until_remote_binding") errors.push("TB write policy must deny writes until remote binding");
const result = {
  status: errors.length ? "blocked" : "valid",
  brand: "brand:tb",
  local_status: tb?.status || null,
  remote_dictionary_codes: binding.remote_dictionary_codes || [],
  remote_mailbox_brand_codes: binding.remote_mailbox_brand_codes || [],
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
