#!/usr/bin/env node
// DESIGN.md 末尾的 Token 登记表必须由实际内容生成：css 列看 frontend/src 下 CSS 的变量定义，
// md 列看 DESIGN.md 正文（登记表之外）的引用。手工改表会让「✅」与 styles.css 脱节，
// 默认模式只校验表格与实际一致；--write 重新生成。缺失（⚠️）如实列出，不拦发布。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const designPath = path.join(root, "docs", "DESIGN.md");
const cssRoot = path.join(root, "frontend", "src");
const HEADING = "## 附：Token 登记表（md ↔ css 对账）";
const write = process.argv.includes("--write");

function cssFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

const defined = new Set();
for (const file of cssFiles(cssRoot)) {
  const text = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of text.matchAll(/(?<![\w-])(--[a-z0-9][a-z0-9-]*)\s*:/gi)) defined.add(match[1]);
}

const design = fs.readFileSync(designPath, "utf8");
const eol = design.includes("\r\n") ? "\r\n" : "\n";
const start = design.indexOf(HEADING);
if (start < 0) {
  console.error(`DESIGN.md 缺少「${HEADING}」小节`);
  process.exit(1);
}
const after = design.slice(start + HEADING.length);
const nextHeading = after.search(/\r?\n## /);
const end = nextHeading < 0 ? design.length : start + HEADING.length + nextHeading;
const body = design.slice(0, start) + design.slice(end);

const referenced = new Set();
for (const match of body.matchAll(/`(--[a-z0-9][a-z0-9-]*)(\*?)/gi)) {
  // `--cat-*` 这类通配写法指一族 token，不是某个具体变量。
  if (match[2] === "*" || match[1].endsWith("-")) continue;
  referenced.add(match[1]);
}

const tokens = [...referenced].sort();
const missing = tokens.filter((token) => !defined.has(token));
const section = [
  HEADING,
  "",
  "> 本表由 `backend/scripts/check-design-tokens.mjs --write` 从实际内容生成，发布门禁校验表格与实际一致，请勿手改。css 列 = `frontend/src` 下 CSS 有定义；md 列 = 本文正文有引用。⚠️ = 已写入细则但样式尚未定义，属待落地项，不代表已实现。",
  "",
  "| token | css 定义 | md 引用 |",
  "|---|---|---|",
  ...tokens.map((token) => `| \`${token}\` | ${defined.has(token) ? "✅" : "⚠️"} | ✅ |`),
  "",
].join(eol);

const current = design.slice(start, end).replace(/\s+$/, "");
const expected = section.replace(/\s+$/, "");
if (write) {
  fs.writeFileSync(designPath, design.slice(0, start) + section + design.slice(end).replace(/^\s+/, eol), "utf8");
  console.log(`已重新生成登记表：${tokens.length} 个 token，⚠️ ${missing.length} 个`);
  process.exit(0);
}
if (current !== expected) {
  console.error("DESIGN.md 的 Token 登记表与实际内容不一致；运行 node backend/scripts/check-design-tokens.mjs --write 重新生成。");
  const claimed = new Map([...current.matchAll(/\| `(--[^`]+)` \| (✅|⚠️) \|/g)].map((m) => [m[1], m[2]]));
  for (const token of tokens) {
    const actual = defined.has(token) ? "✅" : "⚠️";
    if (claimed.get(token) !== actual) console.error(`  ${token}: 表格写 ${claimed.get(token) || "（缺行）"}，实际 ${actual}`);
  }
  for (const token of claimed.keys()) if (!referenced.has(token)) console.error(`  ${token}: 正文已不再引用`);
  process.exit(1);
}
console.log(`Token 登记表与实际一致：${tokens.length} 个 token，⚠️ 待落地 ${missing.length} 个`);
