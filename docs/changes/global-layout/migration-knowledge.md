# 知识浏览布局迁移记录

- **页面与路由：** `frontend/src/pages/Knowledge.tsx`，员工知识浏览路由 `/kb`（`/market/kb` 继续由既有路由重定向）。
- **变更边界：** 仅改动指定页面及其唯一局部样式 `frontend/src/pages/global-layout-knowledge.css`；未修改共享组件、其他页面、`styles.css`、路由、接口、请求、确认、阶段、审批、风险或权限逻辑。
- **依据：** `docs/CONSTITUTION.md`（CONST-04/05/06/10）、`docs/TECHNOLOGY.md`（TECH-FE-01/03、TECH-TEST-01/03/04）、`docs/DESIGN.md` §1/§4/§5/§28、`docs/ia-information-architecture.md` §1/§2，以及已批准的 `deliverables/kol-global-layout-goals-plan.md`。

## 最小迁移

1. 用共享 `PropertyList` 替换本页右栏“来源与版本”中的临时 `dl` 展示。状态、发布人、版本、更新时间与适用范围均保留原字段、原格式化函数和原内容；根节点继续保留 `data-kb-provenance` 与 `aria-label="来源与版本"`。
2. 将正文前的“主题”键值块也改为共享 `PropertyList`，不删除或缩写主题值。
3. 两个属性块使用 `labelWidth="short"`。共享样式从既有 token 取得短标签列 `--property-label-w-short`（96px）与 `--property-label-gap`（`--space-5`，24px），值从统一起点开始；共享 `PropertyList` 维持 13px 基准字号。
4. 新增的局部 CSS 仅以 `.knowledge-browse` 为选择器前缀，补回详情元数据分组的分隔、间距及主题块间距；没有重写共享属性布局或全局 token。

## 已合规保留

- **知识列表：** 保留 `KnowledgeListRow`。它是 DESIGN §28 指定的标题左、类型右、36px 单行知识行；所有 `data-knowledge`、`data-kb-open`、`data-kb-row`、焦点返回及选择行为不变。未将其改为普通 div 列表，也未引入新的记录行壳。
- **操作与风险：** 保留 `DetailActionBar` 与原 `CompactButton`。仅“带入工作草稿”仍是唯一 L1；“没帮助”“反馈 / 隐藏”仍是现有低强调动作。原有引用、预填、隐藏/取消隐藏、失败信息、确认文案与请求均未改变。
- **正文与异常：** 保留 `KnowledgeDocumentBody` 的章节目录、`details` 展开、版本变化 `details`、隐藏原因面板、加载/服务错误与重试。未将正文或异常硬塞进单行记录。
- **表单：** 当前员工知识浏览页没有短编辑 `Form`，因此没有牵强接入 `HorizontalForm`。

## 需要多行的例外

- 右栏详情的状态、发布人、版本、更新时间、适用范围及可选主题是完整对象事实，按属性行纵向分层；适用范围标签可按真实数量自然换行。
- 长主题、摘要、变量说明、版本差异、完整正文、隐藏原因与真实服务错误保留为详情层内容；正文仍可通过目录和章节展开阅读。
- 列表中的长标题仍由既有可聚焦列表项打开右栏全文，不删除标题，也不因压缩而隐藏详情入口。

## 验证与未覆盖范围

- 已静态核对既有知识浏览 E2E 的关键选择器：`[data-kb-provenance]`、`aria-label`、`[data-kb-scope]`、`[data-kb-open]` 和正文标记均保留。
- 执行 `npm run typecheck`（`frontend/`）未通过，原因是当前工作副本没有前端依赖（例如 `react`、`antd` 与 `react/jsx-runtime` 无法解析），并导致仓库范围的大量既有诊断；未发现可归因于 `Knowledge.tsx` 本次迁移的单独诊断。未安装依赖、未启动浏览器、未运行 E2E。
- 本记录只覆盖 `/kb` 员工知识浏览的右栏属性布局；管理端知识页、共享 `InlineMetadata` 的其他使用方、实际浏览器尺寸/键盘/触摸验证、真实用户测试与全站覆盖均未在本任务中完成。
