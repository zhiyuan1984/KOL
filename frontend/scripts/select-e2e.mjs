#!/usr/bin/env node
/**
 * 按 git diff 中的 frontend/src 改动推断应跑的 E2E spec。
 * 无映射时打印提示并退出 0，不阻塞本地流程。
 * 用法：node scripts/select-e2e.mjs
 */
import { execSync } from "node:child_process";
import { basename, dirname } from "node:path";

const E2E_DIR = "e2e";

function gitChangedFiles() {
  try {
    return execSync("git diff --name-only HEAD", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function specsForPath(file) {
  if (!file.startsWith("frontend/src/")) return [];
  const rest = file.slice("frontend/src/".length);
  const dir = dirname(rest);

  // Route and shared workspace changes must keep saved session addresses stable.
  if (["App.tsx", "pages/Session.tsx"].includes(rest)) {
    return ["session-workspace-presentation.spec.ts", "discovery-presentation.spec.ts", "session-task-run.spec.ts"];
  }

  // Connector / admin
  if (dir.startsWith("admin/connector")) return ["connector-admin.spec.ts"];
  if (dir.startsWith("admin/")) {
    return [
      "admin-agents.spec.ts",
      "admin-employees.spec.ts",
      "admin-knowledge.spec.ts",
      "admin-costs.spec.ts",
      "agents-roles.spec.ts",
    ];
  }

  // Home workspace
  if (dir === "home" || dir.startsWith("home/") || rest === "pages/Home.tsx") {
    return [
      "session-workspace-presentation.spec.ts",
      "discovery-presentation.spec.ts",
      "home-discovery-pane.spec.ts",
      "home-followed-focus.spec.ts",
      "home-followed-legacy-projection.spec.ts",
      "home-followed-memory-projection.spec.ts",
      "home-followed-rail-layout.spec.ts",
      "home-four-panel.spec.ts",
      "home-pane-parity.spec.ts",
      "home-plan-analysis.spec.ts",
      "home-plan-cache.spec.ts",
      "home-plan-trace.spec.ts",
      "home-pool-follow.spec.ts",
      "home-surface-failure.spec.ts",
      "home-chat-send-ne-stage.spec.ts",
    ];
  }

  // Chat / session / composer
  if (
    ["pages/Chat.tsx", "components/ChatBlocks.tsx", "components/ComposerDock.tsx"].includes(rest) ||
    dir.startsWith("components/Composer")
  ) {
    return ["workbench.spec.ts", "session-task-run.spec.ts", "composer-prompt-input.spec.ts", "session-workspace-presentation.spec.ts"];
  }

  // Generic components likely affect workbench / composer
  if (dir.startsWith("components/")) {
    return ["workbench.spec.ts", "composer-prompt-input.spec.ts"];
  }

  // Layout / shell
  if (dir.startsWith("layout/")) return ["workbench.spec.ts"];

  // Mail
  if (dir.startsWith("mail/") || rest === "pages/Mail.tsx") {
    return ["home-chat-send-ne-stage.spec.ts", "home-four-panel.spec.ts"];
  }

  // Skill lifecycle
  if (
    dir.startsWith("admin/skill") ||
    dir.startsWith("skill") ||
    rest.startsWith("pages/Skill")
  ) {
    return ["SkillHub.spec.ts", "SkillCatalog.spec.ts", "skill-template.spec.ts"];
  }

  // Knowledge
  if (
    dir.startsWith("admin/knowledge") ||
    dir.startsWith("knowledge") ||
    rest === "pages/Knowledge.tsx"
  ) {
    return ["Knowledge.spec.ts", "admin-knowledge.spec.ts"];
  }

  // Reviews / approvals
  if (
    ["pages/Approvals.tsx", "pages/Reviews.tsx", "pages/ReviewTypes.tsx"].includes(rest) ||
    dir.startsWith("reviews")
  ) {
    return ["Approvals.spec.ts", "Reviews.spec.ts", "review-workflow.spec.ts"];
  }

  // Cron
  if (rest === "pages/Cron.tsx" || dir.startsWith("cron")) return ["cron-workbench.spec.ts"];

  // Exam
  if (rest === "pages/Exam.tsx") return ["Exam.spec.ts"];

  // Account settings
  if (rest === "pages/AccountSettings.tsx") return ["AccountSettings.spec.ts"];

  // Catch-all pages
  if (dir.startsWith("pages/")) return ["workbench.spec.ts"];

  return [];
}

function main() {
  const changed = gitChangedFiles();
  const frontendChanged = changed.filter((f) => f.startsWith("frontend/src/"));

  if (frontendChanged.length === 0) {
    console.log("No frontend/src changes detected; skipping affected E2E selection.");
    process.exit(0);
  }

  const specs = new Set();
  for (const file of frontendChanged) {
    for (const spec of specsForPath(file)) specs.add(`${E2E_DIR}/${spec}`);
  }

  if (specs.size === 0) {
    console.log("Could not infer affected E2E specs from changed files:");
    for (const f of frontendChanged) console.log(`  - ${f}`);
    console.log("Run 'npm run test:e2e' for full suite or specify specs manually.");
    process.exit(0);
  }

  const specList = Array.from(specs).sort().join(" ");
  console.log(`Affected E2E specs (${specs.size}): ${specList}`);

  const cmd = `npx playwright test ${specList}`;
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch (e) {
    process.exit(e.status ?? 1);
  }
}

main();
