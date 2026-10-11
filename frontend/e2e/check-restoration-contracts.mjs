import fs from 'node:fs';
import path from 'node:path';
const base = path.resolve(process.cwd(), '..');
const checks = [
  ['frontend/src/pages/Cron.tsx', ['CronTheme', 'Table<CronJob>', 'Drawer', 'actionAllowed', 'fromZonedInput', 'data-cron-page']],
  ['frontend/src/cron/cronTime.ts', ['Asia/Shanghai', 'fromZonedInput']],
  ['backend/src/cron/public-read-model.ts', ['cronPublicReadFields', 'canMutateJob', 'canSeeJob', 'last_result_label']],
  ['frontend/src/pages/SkillCatalog.tsx', ['catalogFilters', 'MODE_IDS', 'STAGE_IDS', 'employee_visible', 'onInsert', 'params.get("mode")', 'params.get("stage")']],
  ['frontend/src/pages/SkillLifecycle.tsx', ['onDirtyChange', 'contentDirty', 'contractDirty', 'PublishCheckCard', 'skillPublishCheck', 'can_publish']],
  ['frontend/src/pages/SkillLifecycle.tsx', ['useUnsavedDetailGuard', 'useBlocker', 'beforeunload']],
  ['frontend/src/pages/SkillLifecycleV2.tsx', ['onDirtyChange', 'useUnsavedDetailGuard', 'detailDirtyRef']],
  ['frontend/src/pages/Agents.tsx', ['数字员工', 'RoleCard', 'data-expert-list']],
  ['frontend/src/pages/AdminAgents.tsx', ['PropertyList', 'RecordRow', 'HorizontalForm', 'data-agent-binding-preview']],
];
let failed = 0;
for (const [file, markers] of checks) {
  let text = '';
  try { text = fs.readFileSync(path.join(base, file), 'utf8'); } catch { /* reported below */ }
  const missing = markers.filter(marker => !text.includes(marker));
  if (missing.length) { failed++; console.error(`失败 ${file}: ${missing.join(', ')}`); }
  else console.log(`通过 ${file}: ${markers.length}项恢复/保留标志`);
}
console.log('此检查只确认源码契约存在，不代替浏览器、权限与副作用验证。');
process.exitCode = failed ? 1 : 0;
