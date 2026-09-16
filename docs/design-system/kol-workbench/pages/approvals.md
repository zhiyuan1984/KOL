# 审批页面覆盖规则

> 员工 `/approvals` 是宪法 §4.1 #7 一等能力面：确认与审批队列，不是第二套 Home。本文件约束本页布局、L3 确认与回执。视觉 token 以 `MASTER.md` 为准；`docs/references/openai-style.md` 是默认观感 mood/spec（quiet/white/hairline/capsule 冲突时 OpenAI 胜；主填充 = 产品粉红，hex 只住 MASTER）。

## 职责

- 只回答：哪些单要我确认、当前走到哪、同意或驳回的后果是什么。
- 费用发起走本页规则预览；阶段变更仍在合作确认里提交，不在本页另造阶段机。
- 不复制 Home 待办桶、Chat 线程或 Admin 治理。

## L3

同意、驳回都是高影响动作：

- 第一次点击只打开确认层，不执行。
- 确认层先展示对象、范围、后果，再提供确认按钮。
- 驳回必须填写原因；空原因不能提交。
- 执行中锁定重复确认；关闭后焦点回到触发按钮。
- 成功在卡片上留下持久回执（`role="status"`）。Toast 不能替代回执。刷新后仍能从通知文案或驳回原因读到结果。

## 视觉

- 使用 MASTER 语义 token（`--bg`、`--border`、`--text`、`--text-muted`、`--primary`、`--danger`、`--success`、`--focus-ring`、`--radius-*`、`--space-*`）。
- 禁止本页新写原始 hex，也禁止新代码使用 `--star` / `--canvas` / `--line` / `--muted` / `--red` 迁移别名。
- 安静 chrome：待处理卡片不呼吸闪动；焦点用 `--focus-ring`；分区靠细边框和留白，不靠彩色药丸或重阴影。
- 同一区域只保留一个主按钮；驳回用危险语义。

## 交互状态矩阵

| 元素 | Default / Hover | Focus / Selected | Loading / Disabled / Error |
|---|---|---|---|
| 筛选 | 中性描边 Chip | `aria-pressed` 与底色/边框同时变化 | 不锁死切换 |
| 同意 / 驳回 | 打开确认层，不写库 | 焦点环完整；关闭后回到触发按钮 | 确认层打开时隐藏原按钮 |
| 确认层 | 对象、范围、后果先于按钮 | Dialog 焦点落入原因框或确认按钮；Escape 取消 | 执行中 `aria-busy`；驳回无原因禁用确认 |
| 回执 | 卡片内持久文案 | `role="status"` | 失败用 `role="alert"`，保留确认层与已填原因 |
