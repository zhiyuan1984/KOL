#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, "..");
const require = createRequire(import.meta.url);
const postcss = require(path.join(frontendDir, "node_modules", "postcss"));

// 四个入口必须直接采用共享卡片外壳和头像，避免三入口再次分叉。
const entrypoints = {
  FollowedKolWorkCard: "src/components/FollowedKolWorkCard.tsx",
  PoolPane: "src/home/PoolPane.tsx",
  DiscoveryRuntimeCandidate: "src/home/DiscoveryRuntimeCandidate.tsx",
  DiscoveryLeadRow: "src/home/DiscoveryLeadRow.tsx",
};

// 仅检查本次已迁移的旧卡片类；工具栏、列表、选择、确认与 undo 等仍在用的非卡片类不在阻断范围内。
const legacyCardClass = /\.(?:followed-kol-card|discovery-runtime-(?:candidate|content|heading|avatar|name|status|meta|facts|actions)|discovery-lead(?:-[\w-]+)?|pool-row-[\w-]+|pool-kol-card|pool-profile-link|pool-more-[\w-]+|pool-control|pool-analyze-button)(?![\w-])/;
const styleFiles = [
  "src/styles.css",
  "src/home/followed.css",
  "src/home/workspace/agent-session.css",
  "src/home/discovery-workspace.css",
];

const failures = [];
for (const [name, relativePath] of Object.entries(entrypoints)) {
  const absolutePath = path.join(frontendDir, relativePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  for (const component of ["KolCardShell", "KolAvatar"]) {
    if (!new RegExp(`<${component}\\b`).test(source)) {
      failures.push(`${name} 未渲染共享组件 <${component}>（${relativePath}）。`);
    }
  }
}

for (const relativePath of styleFiles) {
  const absolutePath = path.join(frontendDir, relativePath);
  const root = postcss.parse(fs.readFileSync(absolutePath, "utf8"), { from: absolutePath });
  root.walkRules((rule) => {
    if (legacyCardClass.test(rule.selector)) {
      failures.push(`${relativePath} 仍包含旧卡片选择器：${rule.selector}`);
    }
  });
}

if (failures.length) {
  console.error("KOL 展示静态检查失败：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("KOL 展示静态检查通过：4 个入口均使用 KolCardShell 与 KolAvatar，目标旧卡片类已不在样式中。");
}
