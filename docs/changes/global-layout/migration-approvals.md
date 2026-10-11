# 审批队列布局迁移记录

**范围：** 仅审批展示层。本次未改路由、接口、请求参数、字段名、校验、确认、风险/阶段/审批规则、权限判断、后端状态或共享组件；未改 `styles.css`、`InformationLayout.tsx` 或动态 `ReviewForm`。

## 实际路由与入口

| 路由/入口 | 实现 | 本次结果 |
|---|---|---|
| `/approvals` | `frontend/src/pages/Reviews.tsx` | **实际主入口**。现有四列表格（申请标题、流程、状态、发起时间）已经是合规 `table`，保持原结构、列、行点击、搜索、分页和测试契约；未改成 div 列表。其已打开的详情由 `ReviewDetail.tsx` 迁移短属性展示。 |
| `/reviews/:id` | `frontend/src/pages/Reviews.tsx` | 与主入口复用同一审批工作台；详情共享本次 `ReviewDetail.tsx` 的属性布局。 |
| `/approvals/:id` | `frontend/src/pages/Approvals.tsx` | 遗留/独立 ID 队列：迁移为共享记录行与分层详情。 |
| `/approvals/legacy` | `frontend/src/pages/Approvals.tsx` | 遗留审批队列：同上。 |
| 审批专员嵌入面 | `AgentApprover.tsx` → `Approvals.tsx` | 复用同一遗留队列展示；未改变嵌入入口的“只由本人点同意/驳回”约束。 |

## 最小迁移

### `frontend/src/pages/Approvals.tsx`

1. **发起费用审批**改用共享 `HorizontalForm` 与 `Form.Item` 形成单列的短标签—值布局；共享 token 提供短标签列和 `--property-label-gap`（当前为 `--space-5`，即 **24px**）的中间留白。
   - 原生 input/select 的状态、`name`、`required`、`onChange`、`onBlur`、预览、错误、提交、确认、幂等键和请求均保留。
   - 为现有原生控件补充 `aria-label`，没有替换其字段所有者或验证逻辑。
2. 遗留非表格审批记录改用 `RecordRow`：可截断且可点击查看全文的标题、审批类型元信息、文本状态和行内操作在同一行；以 `ActionGroup` 放置“查看详情/决定/说明风险”。
3. 展开层把短事实（适用规则、金额档、申请人、等待时长、当前节点、业务影响、规则版本）改为 `PropertyList`；审批路径、通知、真实回执、拒绝原因、风险说明和确认动作保留在详情层，不为压缩行高删除。
4. 保留所有既有 `data-approval-*` 属性；静态检查已确认队列、发起、记录、决定、详情、转交、加签、撤回、元信息、路径与回执选择器仍存在。

### `frontend/src/reviews/ReviewDetail.tsx`

1. 实际审批详情的**来源材料快照**、当前申请的短字段（发起人、发起时间和非正文、非附件字段）以及知识发布结构化字段改用共享 `PropertyList`（短标签、左值右、24px 中间留白）。
2. 详情标题使用 `TruncatableText`，超长标题仍可通过键盘/触摸路径阅读完整内容。
3. 多行正文仍作为独立详情块：`textarea` 型申请内容、发布说明和知识正文均没有被硬塞进单行属性表。

## 已合规而保留

- `Reviews.tsx` 的审批主列表继续使用原有 **`table`**；没有改列、表头、状态文本、排序说明、搜索/筛选、分页、行点击或深链加载。
- `Reviews.tsx` 的发起审批原生短字段、`ReviewForm` 动态字段、附件、审批人选择、草稿、预览、提交及确认逻辑没有修改。
- 审批详情的 `ReviewActions`、确认弹窗、风险提示、当前责任、阻断错误、审批步骤、办理结果和外部/知识发布真实回执没有改业务语义或权限。

## 需要多行/保留原结构的例外

| 内容 | 保留原因 |
|---|---|
| `textarea` 型申请正文、发布说明、知识正文 `pre` | 正文/长说明，必须完整阅读，不以单行或静默裁切换密度。 |
| 审批路径、当前与历史轮次、任务意见/期限 | 是过程流和异常/时限事实，保持展开层。 |
| 附件链接、知识范围材料、发布回执与发布错误 | 需要保留真实回执、文件可达性和错误恢复语义。 |
| 历次申请材料 | 是带附件的跨版本对比资料，仍保留原 `dl` 结构，未强行改写。 |
| 主入口的审批表格 | 已有正确数据表列结构，按要求登记保留。 |

## 未覆盖/后续范围

- 未迁移动态 `ReviewForm`、审批人选择、草稿/预览/确认或主入口创建区；这是为了保留原生输入所有者、字段校验和审批行为。
- 未做全站或全审批域覆盖声明；本记录仅覆盖上述实际主入口、实际详情和遗留队列入口。
- 未执行真实用户测试、浏览器 E2E、服务端/权限回归或真实审批写入验证。

## 本地检查与限制

- 已执行静态 selector 保留检查：通过。
- 对两个已修改 TSX 文件执行了依赖无关的 TypeScript 语法检查；未发现 TypeScript 语法诊断代码。
- `npm run typecheck` **未能完成**：当前 sandbox 的 `frontend/node_modules` 和工作区 `node_modules` 均不存在，导致 React、Ant Design 和 JSX runtime 模块/类型无法解析。
- `npm run check:kol-presentation` **未能执行**：`frontend/package.json` 引用的 `scripts/check-kol-presentation.mjs` 在当前工作副本不存在。

这些限制不等同于类型检查、E2E、真实用户测试或生产审批流程通过。
