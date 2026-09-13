import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(backend, "..");
const paths = (process.env.REDACTION_SCAN_PATHS || "artifacts,data-e2e")
  .split(/[;,]/).map((value) => value.trim()).filter(Boolean)
  .map((value) => path.resolve(root, value));
const extensions = new Set([".log", ".json", ".jsonl", ".txt"]);
const forbidden = [
  { name: "bearer", pattern: /Bearer\s+[A-Za-z0-9._-]{12,}/i },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}/ },
  { name: "secret-field", pattern: /(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)\s*[=:]\s*["']?[^\s,"'}]{8,}/i },
];
const findings = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (extensions.has(path.extname(entry.name).toLowerCase())) {
      const text = fs.readFileSync(full, "utf8");
      for (const rule of forbidden) if (rule.pattern.test(text)) findings.push({ file: path.relative(root, full), rule: rule.name });
    }
  }
}
for (const dir of paths) walk(dir);
const report = { status: findings.length ? "blocked" : "pass", scanned: paths.map((value) => path.relative(root, value)), findings, generated_at: new Date().toISOString() };
const output = process.env.REDACTION_REPORT || path.join(root, "artifacts", "security", "redaction.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (findings.length) process.exitCode = 1;
