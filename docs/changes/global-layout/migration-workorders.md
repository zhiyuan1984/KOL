# 工单治理页面布局迁移记录

## 范围与状态

- **页面路由：** `/admin/work-orders`（未变更）
- **实施模式：** display-only / preserve；遵循 `docs/CONSTITUTION.md`（CONST-04、05、10）、`docs/TECHNOLOGY.md`（TECH-FE-01/03、TECH-TEST-01~03）、`docs/DESIGN.md` §1、§4、§5、§9、§19、§24、§25，以及 `docs/ia-information-architecture.md` §1、§3。
- **批准计划：** `/home/ubuntu/deliverables/kol-global-layout-goals-plan.md` 的模式 A/B/C。未改变路由、读写请求、服务端权限、确认、审计、风险、阶段、审批或数据模型。

## 实际最小迁移

1. **短属性（模式 A）**
   - 将头部“数据来源”中的组织来源版本、最近同步改为共享 `PropertyList`；模板“查看配置”中的触发事件、验收条件、路由策略也改为共享 `PropertyList`。
   - 使用 `labelWidth="short"`，共享 token `--property-label-w-short`（96px）与 `--property-label-gap`（`--space-5`，24px）提供统一的左标签、右值与中间留白。
   - 模板说明和数据范围说明保留为属性块下的正文，不牵强塞入短字段行。

2. **短编辑表单（模式 A）**
   - 人员绑定的两个选择字段迁移到共享 `HorizontalForm` + `Form.Item`；绑定原因作为 `ui-field-stacked` 多行例外。
   - `HorizontalForm` 使用 `component={false}`，内层保留原生 `<form className="ui-horizontal-form work-order-binding-form" onSubmit={bind}>`，因此原字段名 `account_id` / `person_ref` / `reason`、`required`、`minLength={2}`、`maxLength={500}`、`FormData` 提交、原生校验、禁用条件和确认流程均未改写。

3. **标题、状态、动作与长内容分层（模式 B/C）**
   - 模板仍是语义正确的数据表；标题、等级、发布状态、自动执行和操作保持同一 `<tr>` 的列结构，不改成 `div` 列表。
   - 标题改用共享 `TruncatableText`：正常行保持紧凑，溢出时有键盘/触摸可达的“展开”路径。
   - 模板操作单元迁移到共享 `ActionGroup`，继续使用既有 L3 文字动作、禁用条件和确认回调。
   - “查看配置”继续是按需展开第二层，未把长说明/配置强塞进正常单行。

4. **局部样式**
   - 新增 `frontend/src/pages/global-layout-workorders.css`，所有选择器均以 `.work-order-governance` 限定；仅组合已登记 token，未修改共享组件或 `styles.css`。

## 已合规并保留

- 组织数据质量、组织工单存量、分类与阶段、AI 工单任务战报、模板清单均为已有正确数据表结构，保留 `<table>` / `<thead>` / `<tbody>`，没有迁移为 `div` 列表。
- `LifecycleWorkspace`、`LifecycleNavigation`、`ReadBlock` 的分视图状态、局部加载/失败/重试、真实诊断展开和空态均保留。
- 所有 API 调用、状态筛选/搜索、模板草稿、A3 条件显示、发布/停用/自动执行确认、绑定确认、风险文案、审计链接和现有 `data-*` 测试属性均保留。

## 需要多行或展开的明确例外

- 绑定原因 textarea；模板说明；模板配置详情；A3 阶段与证据配置。
- 数据质量阻断说明、任务目标与当前阻断工单、读取失败的诊断详情。这些是实际异常、证据或恢复信息，未为单行密度删除。
- 模板标题仅在实际溢出时截断，并提供明确展开路径。

## 验证与限制

- 已完成：TypeScript AST/TSX 解析通过；页面专用 CSS 的花括号及 `.work-order-governance` 作用域检查通过；对原字段名、原生 submit、校验属性、模板和回执 `data-*` 属性、确认/请求引用执行了静态保留检查。
- 已核对：Ant Design 6.6.5 的 `Form.Item` 继承 `htmlFor`，用于保持标签与原生控件关联。
- 未运行：`npm run typecheck`、Playwright E2E、浏览器响应式/可访问性检查；此执行环境没有 `frontend/node_modules`，且本任务不启动共享浏览器。
- 未做：真实用户测试、生产 PostgreSQL/权限/外部集成验证、部署或发布。静态解析不等同于完整业务闭环或真实用户验收。

## 仍未覆盖范围

- 本记录仅覆盖 Admin Work Orders 的局部展示迁移；不宣称其他页面或全站已迁移。
- 本页没有适合从非表格列表迁移为 `RecordRow` 的重复记录：所有重复治理记录均已是合规表格，因而未人为新增平行 `div` 行。
- 现有接口仅返回受限模板/任务集合的业务事实与分页能力缺口仍按页面既有说明保留，未由前端推断补齐。
