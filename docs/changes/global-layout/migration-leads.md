# 线索页信息布局迁移登记

- **页面 / 路由：** `frontend/src/pages/Leads.tsx` / `/leads`
- **本次展示资产：** `frontend/src/pages/Leads.tsx`、`frontend/src/pages/global-layout-leads.css`
- **范围：** 只改变线索页的展示组合；没有修改共享组件、`styles.css`、路由、接口、权限、数据模型、确认或请求。
- **依据：** `docs/CONSTITUTION.md`（CONST-04/05/10）、`docs/TECHNOLOGY.md`（TECH-FE-01/03、TECH-TEST-01~03）、`docs/DESIGN.md`（13px基准、L3动作、列表/抽屉/表单约束）、`docs/ia-information-architecture.md`（独立入口与路由保留）及批准计划 `deliverables/kol-global-layout-goals-plan.md`。

## 已做的最小迁移

| 区域 | 展示迁移 | 保留内容 / 行为 |
|---|---|---|
| 线索摘要列表 | 非表格记录改为 `RecordRow`：标题与阶段状态同行；平台/账号是必要元信息；品牌、粉丝、未完成工单进入显式第二层。 | `role=listbox/option`、选中态、鼠标与 Enter/Space 打开详情、所有列表字段均保留。长标题可经打开详情进入完整可读路径。 |
| 属性快照 | `Descriptions` 改为 `PropertyList`；共享组件的默认标签列为 112px，标签到内容列间距复用 `--property-label-gap`（24px）。阶段移至详情摘要记录的状态槽，避免同一粒度重复。 | 稳定标识、来源、联系方式脱敏标记、粉丝、品类、品牌、稳定编号、来源批次、更新时间及其“未采集/—”语义均保留。 |
| 详情标题、工单、时间线 | 详情摘要、相关工单和时间线事件改为 `RecordRow`；短状态留在同一行，工单元信息与时间线摘要作为 `detail` 层。标题与事件代码使用 `TruncatableText`。 | 事件核验状态、事件代码、时间、摘要；工单标题、状态、模板、主受理、更新时间均保留。 |
| 动作区 | 阶段动作采用 `ActionGroup`；行内“标记转化”和“归档”呈现为 L3 文本动作。 | 步骤条、终态阻断、R3 标签、推进确认、归档确认、`expected_version`、加载状态与时间线刷新均不变。抽屉中的“确认转化”仍是唯一实际提交 CTA。 |
| 事实记录 | 短表单改用 `HorizontalForm`，标签列用 `short`；按钮与真实错误置于共享表单动作位。 | 事件类型、事实摘要、空摘要校验、禁用/忙碌态、`idempotency_key`、API 调用和错误文本均不变。 |
| 转化抽屉 | 五个短字段改用 `HorizontalForm`；结算条款明确标记为 `ui-field-stacked` 多行字段。 | `kol-lead-convert-form` 表单 ID、字段、必填校验、数值转换、提交 API、幂等键、关闭与完成回调均保留。 |

## 已合规并保留

- 本页**不存在既有数据表**，因此未将任何表格改为 `div` 列表，也没有改变列结构。
- 搜索、阶段/来源筛选、结果总数、列表/详情骨架、空态、加载态、真实异常、自动建单规则的“读取失败/读取中/未配置/已发布但未证明执行”文案均保留。
- 阶段步骤条是受确认约束的流程控制；没有为了套用记录行而改写其交互。
- 创建线索抽屉仍为原生长表单和原验证逻辑；路由 `/leads`、查询参数读取和现有可访问名称保留。

## 需要多行的例外

1. **新建线索**有 10 个字段，属于长表单；未牵强迁移为短横向表单，仍在抽屉中逐字段呈现。
2. **结算条款**是正文编辑字段，采用上标签下编辑区（`ui-field-stacked`），不压成单行。
3. **时间线摘要、相关工单完整元信息、列表补充事实**进入 `RecordRow.detail` 层，避免将长内容挤进标题/状态行。
4. **自动化规则不确定、加载和失败信息**继续以完整真实文案显示；R3 风险、确认后果与终态说明未因紧凑布局删除。

## 本地验证与限制

- 已进行静态范围审计：仅写入本页 `Leads.tsx`、本页局部 CSS 和本登记文件；未改共享组件或全局样式。
- 已静态核对：`PropertyList`、`HorizontalForm`、`RecordRow`、`ActionGroup`、`TruncatableText` 均在页面实际使用；原 `kolLeadList/Detail/Update/Create/Convert/RecordEvent` 调用、`Modal.confirm`、`expected_version`、`idempotency_key`、R3 文案和 `/leads` 路由仍在。
- 已检查全局 `tsc` 输出中没有本页 `TS1xxx` 语法/解析诊断；**完整类型检查未通过**，原因是当前 `frontend/node_modules` 缺失，无法解析 `react`、`react-router-dom`、`antd`、`react/jsx-runtime` 和 CSS 类型声明，随之产生全项目 JSX/隐式 any 诊断。这不是已验证通过的类型检查。
- `package.json` 声明的 `check:kol-presentation` 指向缺失的 `scripts/check-kol-presentation.mjs`，因此该静态脚本无法运行。
- 未启动共享浏览器，未做视觉、端到端、真实接口或真实用户测试；不得据此声称通过全站、真实用户或生产验证。

## 仍未覆盖范围

- 未审计或修改其他页面、共享布局组件、全局 token、后端响应白名单与权限实现。
- 未在实际 320/480/720px 容器、200% 缩放、深色模式、触摸或读屏环境验证；共享组件具备既有容器响应式规则，但本页尚无运行时证据。
- 未验证服务端返回长标题、异常、权限限制或真实外部回执的端到端呈现；现有真实异常文案已按源码保留。
