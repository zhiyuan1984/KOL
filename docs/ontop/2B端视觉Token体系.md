# 2B 端视觉 Token 体系

> 整理时间：2026-10-01
> 本篇是《企业智能体与本体论研究笔记》的拆分文件之一，配套《前后端设计-员工端与管理端.md》。
> 架构（候选）：沿用 Ant Design 三层 Token（Seed Token → Map Token → Alias Token），业务语义 Token 单独一层 `--agent-*`，两端共用一套。
>
> **位阶声明（自检补记，2026-10-01）**：本文件是**非规范研究笔记／候选素材**，不属 `docs/` 规范集正文，不具 CONST-09 任何位阶；文中数值（含 hex）只作候选，未经对比度、三轴适配与验收验证；与现行宪法、基本法、实施细则冲突处一律以现行规范为准。任何采纳须经 UI/UX 专家按 CONST-08 裁定，并入唯一视觉细则后生效（视觉唯一来源已裁定为 `../DESIGN.md`；`../ui-ux-rules.md` 的唯一来源主张已原位废止）。
>
> **吸收状态（2026-10-01）：** 按「以 `DESIGN.md` 为准」的裁决，本笔记的业务语义映射（任务/风险/trace/身份/SLA/知识来源）、动效与等宽字体、间距与深色口径已并入 [`../DESIGN.md`](../DESIGN.md)（见其修订说明⑦）；本文件保留作来源记录，内容不再单独维护。

---

## 一、Token 分层

```
Seed Token（种子：品牌色/字号/圆角/间距基数）
  → Map Token（派生：主色梯度、文字色阶、背景色阶）
    → Alias Token（别名：组件用，如 colorBgContainer）
      → --agent-*（业务语义：任务状态、风险等级、trace 节点）
```

原则（候选主张，采纳须经裁定）：**基础层不动**（直接用 Ant Design 默认），只改 Seed 里的品牌色，业务语义全部收敛到 `--agent-*` 一层。换肤、深色模式只动这两处。

---

## 二、Seed Token（种子）

| Token | 值 | 说明 |
|---|---|---|
| `colorPrimary` | `#1677ff` | 品牌主色：2B 蓝，信任感；Ant Design 默认值，直接沿用 |
| `colorSuccess` | `#52c41a` | 成功 |
| `colorWarning` | `#faad14` | 警告 |
| `colorError` | `#ff4d4f` | 错误 |
| `colorInfo` | `#1677ff` | 信息 |
| `borderRadius` | `6` | 全局圆角：2B 克制风格 |
| `fontSize` | `14` | 基准字号 |
| `fontFamily` | `-apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif` | 中文优先 |
| `fontFamilyCode` | `"JetBrains Mono", "SFMono-Regular", Consolas, monospace` | trace / 代码 / 日志 |
| `spacingBase` | `4` | 间距基数，全部间距为其倍数 |

---

## 三、业务语义 Token（`--agent-*`，核心）

### 3.1 任务状态色（左栏任务列表、任务卡）

| Token | 值 | 用途 |
|---|---|---|
| `--agent-task-todo` | `#8c8c8c`（中性灰） | 待办 |
| `--agent-task-running` | `#1677ff`（主蓝） | 执行中 |
| `--agent-task-confirm` | `#faad14`（警告黄） | 待我确认 |
| `--agent-task-done` | `#52c41a`（成功绿） | 已完成 |
| `--agent-task-overdue` | `#ff4d4f`（错误红） | 超时/升级 |

### 3.2 风险等级色（右栏确认卡、审计案件）

| Token | 值 | 用途 |
|---|---|---|
| `--agent-risk-low` | `#52c41a` | 低风险：绿卡，可一键批准 |
| `--agent-risk-medium` | `#faad14` | 中风险：黄卡，需展开看依据 |
| `--agent-risk-high` | `#ff4d4f` | 高风险：红卡，强制人工确认 |

### 3.3 Trace 节点状态色（中栏执行过程）

| Token | 值 | 用途 |
|---|---|---|
| `--agent-trace-running` | `#1677ff` + 脉冲动画 | 正在执行 |
| `--agent-trace-success` | `#52c41a` | 成功 |
| `--agent-trace-failed` | `#ff4d4f` | 失败（可展开详情/重试） |
| `--agent-trace-waiting` | `#d9d9d9` | 等待执行 |

### 3.4 身份色（区分人与 agent）

| Token | 值 | 用途 |
|---|---|---|
| `--agent-role-human` | `#722ed1`（紫） | 人的操作/消息/确认 |
| `--agent-role-agent` | `#1677ff`（蓝） | agent 的操作/消息 |

trace 时间线里一眼分清"这一步是谁干的"。

### 3.5 SLA 倒计时

| Token | 值 | 用途 |
|---|---|---|
| `--agent-sla-normal` | `#8c8c8c` | 充足（>50% 剩余） |
| `--agent-sla-urgent` | `#fa8c16`（橙） | 紧张（<50% 剩余） |
| `--agent-sla-overdue` | `#ff4d4f` | 已超时 |

### 3.6 知识来源标识色（中栏上下文片段）

| Token | 值 | 用途 |
|---|---|---|
| `--agent-src-memory` | `#13c2c2`（青） | 记忆（事件/工单摘要） |
| `--agent-src-doc` | `#2f54eb`（深蓝） | 文档知识 |
| `--agent-src-pattern` | `#eb2f96`（品红） | 经验 pattern（WikiSkill） |
| `--agent-src-ontology` | `#fa8c16`（橙） | 本体对象快照 |

每个上下文片段左上角打来源色标 + 文字（如"记忆 · 工单摘要"），可追溯。

---

## 四、字体排印 Token

| Token | 值 | 用途 |
|---|---|---|
| `fontSizeSM` | `12` | 辅助文字、时间戳、trace 节点备注 |
| `fontSize` | `14` | 正文 |
| `fontSizeLG` | `16` | 任务标题、卡片标题 |
| `fontSizeXL` | `20` | 页面标题 |
| `fontSizeHeading3` | `24` | 管理端概览数字 |
| `lineHeight` | `1.5715` | 正文行高 |
| `fontWeightNormal` | `400` | 正文 |
| `fontWeightMedium` | `500` | 强调、小标题 |
| `fontWeightSemibold` | `600` | 大标题、关键数字 |

trace 节点、日志、SKILL.md 预览统一用 `fontFamilyCode`。

---

## 五、间距与布局 Token

| Token | 值 | 用途 |
|---|---|---|
| `paddingXS/SM/MD/LG/XL` | `8/12/16/24/32` | 内边距阶梯 |
| `marginXS/SM/MD/LG/XL` | `8/12/16/24/32` | 外边距阶梯 |
| `--layout-sidebar-width` | `240px` | 员工端左栏 |
| `--layout-inspector-width` | `320px` | 员工端右栏 |
| `--layout-header-height` | `56px` | 顶栏 |
| `--layout-card-gap` | `16px` | 卡片间距 |
| `--layout-max-content` | `1200px` | 管理端内容区最大宽度 |

---

## 六、圆角 / 边框 / 阴影

| Token | 值 | 用途 |
|---|---|---|
| `borderRadiusSM/LG` | `4/8` | 小组件 / 大卡片 |
| `borderColor` | `#f0f0f0` | 分隔线、卡片边框 |
| `boxShadowCard` | `0 1px 2px rgba(0,0,0,0.06)` | 卡片 |
| `boxShadowDrawer` | `0 8px 24px rgba(0,0,0,0.12)` | 右栏抽屉、确认卡浮层 |
| `boxShadowRiskHigh` | `0 0 0 2px rgba(255,77,79,0.2)` | 高风险确认卡描边 |

---

## 七、动效 Token

| Token | 值 | 用途 |
|---|---|---|
| `motionDurationFast` | `0.1s` | hover、选中 |
| `motionDurationMid` | `0.2s` | 展开/收起、tab 切换 |
| `motionDurationSlow` | `0.3s` | 抽屉、弹窗 |
| `motionEaseInOut` | `cubic-bezier(0.645, 0.045, 0.355, 1)` | 通用缓动 |
| `--agent-motion-trace` | `pulse 1.2s infinite` | trace 执行中节点脉冲 |
| `--agent-motion-stream` | 打字机/流式 | agent 实时输出 |

trace 节点状态变化（等待→执行→成功）用颜色 + 动效双通道表达，色盲友好。

---

## 八、深色模式

- 基础层：`theme.darkAlgorithm` 一键切换，Map/Alias 自动派生。
- 业务层：`--agent-*` 需单独定义 dark 变体（存 `tokens.dark.css`），重点调：trace 节点色在深底上的对比度、风险红卡的描边强度。
- 建议：员工端默认浅色（长时间工作不累眼），管理端监控大屏可选深色。

---

## 九、落地建议

> 以下为候选建议；涉及技术栈（Ant Design）、品牌色与数值的采纳，须先经受裁定并并入唯一视觉细则（见文首位阶声明）。

1. **直接用 Ant Design**：`ConfigProvider theme={{ token: {...} }}` 配 Seed，业务 token 写 CSS 变量文件，两端共用。
2. **先定 `--agent-*`，再画页面**：任务状态、风险等级、trace 节点是 agent 产品的视觉灵魂，先定色再出图。
3. **一处修改全局生效**：换品牌色只改 `colorPrimary`；调任务状态色只改 `--agent-task-*`，不碰组件。
4. **文档化**：正式业务色登记入口是唯一视觉细则，不在本笔记另立注册表；并入后按该处流程「先登记再使用」。

---

*相关文件：前后端设计-员工端与管理端.md、概念落地对照表-总表.md*

---

## 合规自检记录（2026-10-01）

对照现行规范体系（根 `AGENTS.md` → `CONSTITUTION.md` → 实施细则）自检，结论如下：

1. **位阶**：本文件原未在规范索引登记 → 规则空白；已按文首位阶声明补记（非规范候选素材）。
2. **唯一来源**：原「自任 token 注册表」表述与「唯一视觉数值来源」条款（CONSTITUTION 重建记录、根 `AGENTS.md` §3、`DESIGN.md`／`ui-ux-rules.md`）冲突 → 已改候选口径；唯一来源之争已于 2026-10-01 裁定：视觉唯一来源为 `DESIGN.md`（`ui-ux-rules.md` 的主张原位废止）。
3. **技术栈**：Ant Design 引入与 `TECH-ARCH-01`（组件选型属架构师）及现有纯 CSS + Vite 实现冲突 → 须架构师 + UI/UX 专家裁定。
4. **品牌与颜色**：`#1677ff` 等取值与现行品牌主色 `--primary: #DB1860`、颜色四职责／两来源规则冲突 → 品牌变更属用户 + UI/UX 决定。
5. **数值**：240px／320px 等与锁定 260px 及结果栏几何冲突；平行数值体系只能作候选，采纳须并入唯一来源。
6. **对比度**：多个取值低于现行门槛（文字 ≥4.5:1、图形 ≥3:1；如 `#faad14`≈1.90、`#52c41a`≈2.27）→ 落地前须重算改值。
7. **风险分档**：未映射 L1/L2/L3（根 `AGENTS.md` §4 不变量）→ 用于确认面前须先映射。
8. **无障碍与适配**：非颜色信号与 `prefers-reduced-motion` 未写明；三轴适配、命中区与验收矩阵缺失 → 补齐后方可作为候选体系。
