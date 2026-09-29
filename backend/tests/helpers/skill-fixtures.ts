import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * `taskDefinitions()` 只认 backend/skills 与数据目录下的 published-skills，
 * 所以用到夹具技能的用例都把 tests/fixtures/skills 里的目录复制进临时数据目录。
 */
export const SKILL_FIXTURES_ROOT = path.join(here, "..", "fixtures", "skills");

export function publishFixtureSkills(dataDir: string, ids: readonly string[]): void {
  const root = path.join(dataDir, "published-skills");
  fs.mkdirSync(root, { recursive: true });
  for (const id of ids) fs.cpSync(path.join(SKILL_FIXTURES_ROOT, id), path.join(root, id), { recursive: true });
}
