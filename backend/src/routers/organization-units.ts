import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { parse as parseYaml } from "yaml";
import { requireAdmin } from "../auth.js";
import { HttpFail } from "../host/errors.js";

export const organizationUnitsRouter = new Hono();

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type RegistryUnit = {
  id?: string;
  display_name?: string;
  type?: string;
  parent?: string | null;
  head?: string | null;
};

type OrgRegistry = {
  companies?: { id?: string; display_name?: string }[];
  organization_units?: RegistryUnit[];
  confirmed_people?: { display_name?: string; role?: string; org_unit?: string | null; user_ref?: string | null }[];
};

/** config/org-registry.yaml is JSON-compatible YAML; a broken registry fails loudly instead of serving an empty directory. */
function loadRegistry(): OrgRegistry {
  try {
    const text = fs.readFileSync(path.join(repoRoot, "config", "org-registry.yaml"), "utf8").replace(/^\uFEFF/, "");
    const parsed = parseYaml(text) as OrgRegistry | null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("registry root must be a mapping");
    return parsed;
  } catch {
    throw new HttpFail(503, { code: "organization_registry_unavailable" });
  }
}

/** Depth in the parent chain: a unit hanging directly off the company is level 1. */
function unitLevels(units: RegistryUnit[]): Map<string, number> {
  const byId = new Map(units.map((unit) => [String(unit.id), unit]));
  const levels = new Map<string, number>();
  const levelOf = (id: string, chain: Set<string>): number => {
    const known = levels.get(id);
    if (known) return known;
    if (chain.has(id)) return 1;
    chain.add(id);
    const parentId = byId.get(id)?.parent ? String(byId.get(id)?.parent) : "";
    const level = parentId && byId.has(parentId) ? levelOf(parentId, chain) + 1 : 1;
    levels.set(id, level);
    return level;
  };
  for (const unit of units) levelOf(String(unit.id), new Set());
  return levels;
}

organizationUnitsRouter.get("/admin/organization-units", (c) => {
  requireAdmin();
  const registry = loadRegistry();
  const units = (registry.organization_units || []).filter((unit) => typeof unit?.id === "string");
  const levels = unitLevels(units);
  const company = (registry.companies || [])[0];
  return c.json({
    company: company?.id ? { id: company.id, display_name: company.display_name || company.id } : null,
    units: units.map((unit) => ({
      id: unit.id,
      display_name: unit.display_name || unit.id,
      type: unit.type || null,
      parent: unit.parent || null,
      level: levels.get(String(unit.id)) || 1,
      head: unit.head || null,
    })),
    people: (registry.confirmed_people || []).map((person) => ({
      display_name: person.display_name || "",
      role: person.role || null,
      org_unit: person.org_unit || null,
      user_ref: person.user_ref || null,
    })),
  });
});
