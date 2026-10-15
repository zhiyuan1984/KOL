import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function fail(message) {
  const error = new Error(message);
  error.governance = true;
  throw error;
}

export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) { result._.push(token); continue; }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next == null || next.startsWith("--")) {
      result[key] = true;
      continue;
    }
    index += 1;
    if (result[key] == null) result[key] = next;
    else result[key] = Array.isArray(result[key]) ? [...result[key], next] : [result[key], next];
  }
  return result;
}

export function values(value) {
  if (value == null || value === false) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

export function repoPath(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) fail(`invalid repository-relative path: ${relative}`);
  const normalized = path.posix.normalize(relative.replaceAll("\\", "/"));
  if (normalized === ".." || normalized.startsWith("../")) fail(`path escapes repository root: ${relative}`);
  return { relative: normalized, absolute: path.join(root, normalized) };
}

export function readText(root, relative, purpose = "required source") {
  const target = repoPath(root, relative);
  let content;
  try {
    if (!fs.existsSync(target.absolute)) fail(`${purpose} is missing: ${target.relative}`);
    content = fs.readFileSync(target.absolute, "utf8");
  } catch (error) {
    if (error.governance) throw error;
    fail(`cannot read ${purpose} ${target.relative}: ${error.message}`);
  }
  return { path: target.relative, content, sha256: sha256(content), bytes: Buffer.byteLength(content), purpose };
}

export function readJsonCompatible(root, relative, purpose = "JSON-compatible YAML") {
  const loaded = readText(root, relative, purpose);
  try {
    return { ...loaded, value: JSON.parse(loaded.content.replace(/^\uFEFF/, "")) };
  } catch (error) {
    fail(`${relative} must be JSON-compatible YAML: ${error.message}`);
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function parseSkillFrontmatter(content, relative) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) fail(`skill frontmatter is missing: ${relative}`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!item) fail(`skill frontmatter has an invalid line in ${relative}: ${line}`);
    fields[item[1]] = item[2].replace(/^['"]|['"]$/g, "").trim();
  }
  const unsupported = Object.keys(fields).filter((key) => !["name", "description"].includes(key));
  if (unsupported.length) fail(`skill frontmatter may only contain name and description: ${relative} (${unsupported.join(", ")})`);
  if (!fields.name || !fields.description) fail(`skill frontmatter requires name and description: ${relative}`);
  return fields;
}

function globRegExp(glob) {
  let pattern = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") { pattern += "(?:.*/)?"; index += 2; }
        else { pattern += ".*"; index += 1; }
      } else pattern += "[^/]*";
    } else if (char === "?") pattern += "[^/]";
    else pattern += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

export function matchingPaths(paths, globs = []) {
  return paths.filter((candidate) => globs.some((glob) => globRegExp(glob).test(candidate)));
}

export function deriveIntents(rawIntents, aliases = {}) {
  const phrases = rawIntents.map((item) => item.toLowerCase().replace(/[_\s]+/g, "-").trim());
  const result = new Set(phrases.filter(Boolean));
  for (const [canonical, words] of Object.entries(aliases)) {
    const normalizedCanonical = canonical.toLowerCase();
    if (phrases.some((phrase) => phrase === normalizedCanonical || (words || []).some((word) => phrase.includes(String(word).toLowerCase().replace(/[_\s]+/g, "-"))))) {
      result.add(canonical);
    }
  }
  return [...result].sort();
}

export function dedupe(items) {
  return [...new Set(items)];
}

export function makeLoader(root) {
  const records = new Map();
  function load(relative, purpose) {
    const loaded = readText(root, relative, purpose);
    const prior = records.get(loaded.path);
    if (prior && prior.sha256 !== loaded.sha256) fail(`source changed while loading: ${loaded.path}`);
    const record = prior || { ...loaded, purposes: new Set() };
    record.purposes.add(purpose);
    records.set(loaded.path, record);
    return record;
  }
  function snapshots(includeContent = false) {
    return [...records.values()].sort((a, b) => a.path.localeCompare(b.path)).map((record) => ({
      path: record.path,
      sha256: record.sha256,
      bytes: record.bytes,
      purposes: [...record.purposes].sort(),
      ...(includeContent ? { content: record.content } : {})
    }));
  }
  return { load, snapshots };
}

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function schemaAt(root, reference) {
  if (!reference.startsWith("#/")) fail(`only local schema references are supported: ${reference}`);
  return reference.slice(2).split("/").reduce((cursor, key) => cursor?.[key], root);
}

/** Validate the JSON-Schema subset used by development-task.schema.json without a new runtime package. */
export function validateSchema(rootSchema, schema, value) {
  const errors = [];
  function visit(current, candidate, location) {
    if (!current) { errors.push(`${location}: missing schema`); return; }
    if (current.$ref) { visit(schemaAt(rootSchema, current.$ref), candidate, location); return; }
    if (current.allOf) for (const part of current.allOf) visit(part, candidate, location);
    if (current.anyOf && !current.anyOf.some((part) => { const before = errors.length; visit(part, candidate, location); const valid = errors.length === before; errors.length = before; return valid; })) errors.push(`${location}: does not match any allowed schema`);
    if (current.oneOf) {
      let matched = 0;
      for (const part of current.oneOf) { const before = errors.length; visit(part, candidate, location); if (errors.length === before) matched += 1; errors.length = before; }
      if (matched !== 1) errors.push(`${location}: must match exactly one schema`);
    }
    if (Object.hasOwn(current, "const") && candidate !== current.const) errors.push(`${location}: must equal ${JSON.stringify(current.const)}`);
    if (current.enum && !current.enum.includes(candidate)) errors.push(`${location}: must be one of ${current.enum.join(", ")}`);
    if (current.type) {
      const types = Array.isArray(current.type) ? current.type : [current.type];
      const actual = Array.isArray(candidate) ? "array" : candidate === null ? "null" : Number.isInteger(candidate) ? "integer" : typeof candidate;
      const valid = types.some((type) => type === actual || (type === "number" && (actual === "number" || actual === "integer")) || (type === "object" && plainObject(candidate)));
      if (!valid) { errors.push(`${location}: expected ${types.join("|")}, got ${actual}`); return; }
    }
    if (typeof candidate === "string") {
      if (current.minLength != null && candidate.length < current.minLength) errors.push(`${location}: must have length >= ${current.minLength}`);
      if (current.pattern && !(new RegExp(current.pattern).test(candidate))) errors.push(`${location}: does not match ${current.pattern}`);
    }
    if (typeof candidate === "number") {
      if (current.minimum != null && candidate < current.minimum) errors.push(`${location}: must be >= ${current.minimum}`);
    }
    if (Array.isArray(candidate)) {
      if (current.minItems != null && candidate.length < current.minItems) errors.push(`${location}: must have at least ${current.minItems} items`);
      if (current.items) candidate.forEach((item, index) => visit(current.items, item, `${location}[${index}]`));
    }
    if (plainObject(candidate)) {
      for (const required of current.required || []) if (!Object.hasOwn(candidate, required)) errors.push(`${location}: missing required property ${required}`);
      if (current.minProperties != null && Object.keys(candidate).length < current.minProperties) errors.push(`${location}: must have at least ${current.minProperties} properties`);
      for (const [key, child] of Object.entries(current.properties || {})) if (Object.hasOwn(candidate, key)) visit(child, candidate[key], `${location}.${key}`);
      if (current.additionalProperties === false) {
        const allowed = new Set(Object.keys(current.properties || {}));
        for (const key of Object.keys(candidate)) if (!allowed.has(key)) errors.push(`${location}: unexpected property ${key}`);
      }
    }
  }
  visit(schema, value, "$");
  return errors;
}
