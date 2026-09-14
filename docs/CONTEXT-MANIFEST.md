# Context Manifest：渐进式文档加载

> 目标：按任务加载最少的权威上下文。不要默认把 `docs/`、`specs/` 或历史决策全部送入模型。

## 固定入口

任何实现任务先读 `CONSTITUTION.md`（§4.1 十六项一等能力；§4.2 KOL=首个试点），再按下表加载。只有任务触发某个条件时，才继续读取对应文档。平台能力 vs KOL 试点路由见 `docs/README.md`。Pipeline / Home「AI发现」「我跟进的红人」是 KOL 试点特化，不是平台一等清单。**禁止**员工侧栏挂「生命周期」或 `/pipeline` 主入口。

## UI 任务顺序

```text
CONSTITUTION.md
→ 对应 FS / UX-KOL 验收条目
→ design-system/kol-workbench/MASTER.md
→ design-system/kol-workbench/pages/<当前页面>.md
→ 仅针对未解决的设计问题调用 ui-ux-pro-max
```

先建立业务事实、验收和项目视觉约束，再使用 `ui-ux-pro-max` 补充未解决的问题。其输出是候选建议，不能覆盖项目契约。

## 路由表

| 任务 | 默认加载 | 条件触发后再加载 |
|---|---|---|
| Home | `pages/home.md` | AI 发现、关注：相应 `FS-*` 与 `UX-KOL` ID；能力面细节：`employee-surface-contracts.md` |
| Chat/任务执行 | `pages/chat.md`、`04-ux-ui-system.md` | 按动作加载相应 FS；涉及发送/导入/解密/删除时加载 L3 验收 |
| Pipeline（KOL 试点页；禁止侧栏主入口，深链 / CTA 可达） | `pages/pipeline.md` | 加载生命周期、Collaboration、阶段变更对应 FS。员工侧栏不得出现「生命周期」或 `/pipeline` |
| Admin | `pages/admin.md` | 权限、连接器或审计时加载 `21-admin-employee-page-roles.md` 及对应 FS |
| `/kb`、`/agents`、员工连接器 | `employee-surface-contracts.md` 中对应章节 | 连接器治理再加载 `21-admin-employee-page-roles.md` |
| 技能（一等；侧栏露出=UX） | `employee-surface-contracts.md`「预留 / 占位能力」+ `CONSTITUTION.md` §4.1 | 禁止图鉴压过任务脊柱；引擎词仍走 `UX-COPY-ENGINE` |
| 数字团队（一等；尚未实现） | `CONSTITUTION.md` §4.1 + `employee-surface-contracts.md` | 禁止专家团假导航；不得永久禁该名词 |
| 审批 / 考试 | `employee-surface-contracts.md`、`08-permission-approval-audit.md` | 管理闸门再加载 `21-admin-employee-page-roles.md` |
| `/cron` 定时 | `employee-surface-contracts.md` 今日工作簇 | 不得画进资产簇 |
| 纯视觉/组件 | `MASTER.md` 与当前页面规范 | 只有追溯迁移原因时读取 `20-visual-design-system.md` |
| API/后端 | 对应 FS、接口或数据模型文档 | 仅当影响 UI 状态或副作用时加载本宪法相关章节 |
| 回归/验收 | 改动对应的 FS/UX ID | 需要追踪历史原因时读取 `DECISIONS.md` 或证据文档 |

## 默认不加载

- `references/`：风格研究和历史提示词，不是实施规则。
- `DECISIONS.md`：仅用于追溯具体决策。
- 截图、证据和阶段报告：仅在验证相关行为时加载。
- 完整 `employee-surface-contracts.md`：只在对应能力面任务中读取；`20-visual-design-system.md` 只作迁移索引。

## 检索纪律

1. 先确定页面、用户动作、风险等级和验收 ID。
2. 用 `rg` 定位相关标题或 ID，只读取命中段落及必要上下文。
3. 外部建议只进入当前研究笔记；未经验证不得写入 MASTER 或宪法。
4. 任务完成后只持久化稳定规则、明确决策和验收变更，不保存冗长研究过程。

## 维护规则

- 新增跨页面硬约束：修改 `CONSTITUTION.md`。
- 修改全局视觉 token 或组件规则：修改 `MASTER.md`，并同步实现 token。
- 修改单页布局或行为：只修改对应 `pages/*.md`。
- 修改业务状态、权限或验收：修改 FS/UX 契约，不把业务事实复制进视觉文档。
