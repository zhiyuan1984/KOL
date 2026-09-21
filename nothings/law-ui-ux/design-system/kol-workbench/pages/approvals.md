# 审批页面覆盖规则

> 员工 `/approvals` 是宪法 §4.1 #7 一等能力面：确认与审批队列，不是第二套 Home。本文件约束本页布局、L3 确认与回执。视觉 token 以 `MASTER.md` 为准；`docs/references/openai-style.md` 是默认观感 mood/spec（quiet/white/hairline/capsule 冲突时 OpenAI 胜；主填充 = 产品粉红，hex 只住 MASTER）。

## 职责

- 只回答：哪些单要我确认、当前走到哪、同意或驳回的后果是什么。
- 费用发起走本页规则预览；阶段变更仍在合作确认里提交，不在本页另造阶段机。
- 不复制 Home 待办桶、Chat 线程或 Admin 治理。
- 不在前端计算审批链、金额档或阶段权限；展示后端返回的可见字段与允许动作。

## 三个盒子

| 盒子 | URL | 含义 |
|---|---|---|
| 待我决定 | `?box=inbox`（默认） | 当前轮到登录人确认 |
| 我发起的 | `?box=submitted` | 我提交的单 |
| 已处理 | `?box=done` | 我已决定或已办结且与我相关 |

深链保留 `?id=`，也可打开 `/approvals/:id`。侧栏角标只读 `GET /api/approvals/badge` 的 inbox 整数，不把「等审批」加进 Home。

## L3

同意、驳回都是高影响动作：

- 第一次点击只打开确认层，不执行。Inbox 行先用「决定」展开，再选同意或驳回。
- 确认层先展示对象、范围、变更、后果、适用审批状态和规则版本，再提供确认按钮。
- 驳回必须填写原因；空原因不能提交。普通取消只关层，不走驳回。
- 决定与发起都带 `expected_version` + `idempotency_key`。内容变化返回 409/`stale`，旧确认作废。
- 执行中锁定重复确认；关闭后焦点回到触发按钮。
- 成功在卡片上留下持久回执（`role="status"`）。Toast 不能替代回执。刷新后仍能从通知文案或驳回原因读到结果。
- 费用发起：预览后独立 L3 确认，创建卡上留「已提交」回执，不只靠 Toast。
- 批准、网关已接受、外部回执分三行。未知外部回执写「待核对」，不得绿勾为成功。

## 视觉

- 使用 MASTER 语义 token（`--bg`、`--border`、`--text`、`--text-muted`、`--primary`、`--danger`、`--success`、`--focus-ring`、`--radius-*`、`--space-*`）。
- 禁止本页新写原始 hex，也禁止新代码使用 `--star` / `--canvas` / `--line` / `--muted` / `--red` 迁移别名。
- 安静 chrome：待处理卡片不呼吸闪动；焦点用 `--focus-ring`；分区靠细边框和留白，不靠彩色药丸或重阴影。
- 同一视口只保留一个实底主按钮；Inbox 才有实底「决定」。驳回用危险语义。
- 路径节点除颜色外必须有文字：已通过 / 当前 / 已驳回。

## 交互状态矩阵

| 元素 | Default / Hover | Focus / Selected | Loading / Disabled / Error |
|---|---|---|---|
| 筛选 | 中性描边 Chip | `aria-pressed` 与底色/边框同时变化 | 不锁死切换；URL `?box=` 可恢复 |
| 决定 / 同意 / 驳回 | 打开确认层，不写库 | 焦点环完整；关闭后回到触发按钮 | 确认层打开时隐藏原按钮 |
| 确认层 | 对象、范围、变更、后果、状态、版本先于按钮 | Dialog 焦点落入原因框或确认按钮；Escape 取消 | 执行中 `aria-busy`；驳回无原因禁用确认；`stale` 作废旧层 |
| 回执 | 卡片内持久文案 | `role="status"` | 失败用 `role="alert"`，保留确认层与已填原因 |
