# 邮箱通讯页四栏改版实施计划

> 对应设计规格：`docs/superpowers/specs/2026-09-23-mail-correspondent-workbench-design.md`

## Phase 1 技能（已完成）

- 新建 `backend/skills/mail_summary/SKILL.md`、`backend/skills/mail_translate/SKILL.md`。
- 更新 `docs/BUSINESS.md` 技能计数。

## Phase 2+3 后端记忆增量（已完成）

- `backend/src/db.ts`：`kol_mail_items` 增 `memory_fingerprint / memory_source / memory_generated_at / memory_error / memory_attempts`。
- `backend/src/host/mail-memory.ts`：`persistItemMemory`、`markItemMemoryPending`、`markThreadTranslationsPending`；`ConversationRow` 增 `message_count`。
- `backend/src/host/mail-memory-job.ts`：增量协调器，扫描缺产物/指纹变化，调用翻译/总结/会话摘要/人来往摘要，写回记忆。
- `backend/src/starrykol/mail-sync.ts`：同步成功后 `markPendingMailMemory` + `triggerMailMemoryIncrement`。
- `backend/src/routers/mail.ts`：读取路径零模型；新增 `GET /api/mail/person` 读取人来往总结记忆。

## Phase 4 定时任务（已完成）

- `backend/src/cron/handlers.ts`：新增 `mail-memory-increment` handler，async 化 `CronHandler`。
- `backend/src/cron/worker.ts`：`executeCronRun`、`tickCronDue`、`runCronJobNow` 改 async。
- `backend/src/cron/store.ts`：登记系统作业 `cjob_mail_memory_increment`（`*/10 * * * *`）。
- `backend/src/routers/cron.ts`：路由 await。
- 更新 `backend/tests/cron-jobs.test.ts`。

## Phase 5 前端四栏（进行中）

- `frontend/src/mail/text.ts`：HTML 实体解码。
- `frontend/src/mail/groups.ts`：按对端聚合。
- `frontend/src/mail/components/CorrespondentRow.tsx`：组行。
- `frontend/src/mail/components/MailAssist.tsx`：栏4 总结+翻译，只读记忆。
- `frontend/src/pages/Mail.tsx`：四栏布局、URL `?p=&c=&m=`、默认选中、邮箱切换移入栏2。
- `frontend/src/styles.css`：独立滚动、320px 栏宽、越界修复。
- 更新 `frontend/e2e/mail.spec.ts`。

## Phase 6 验收（待完成）

- 后端：`npm run typecheck`、`npm test`、`npm run validate:contracts`。
- 前端：`npm run typecheck`、`npm run build`、`npx playwright test mail.spec.ts`。
- 截图：1440×900、1280×800。

## Phase 7 文档（待完成）

- 更新设计规格「实施状态」。
- 补 `docs/DECISIONS.md` 记录形态一选择。
