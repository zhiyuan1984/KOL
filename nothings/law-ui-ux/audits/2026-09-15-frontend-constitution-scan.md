# 前端宪法 / 法律 / 契约扫描

日期：2026-09-15  
范围：`frontend/src` 全部路由、页面和共享组件；依据 `docs/README.md`、`docs/CONSTITUTION.md`、`specs/UX-KOL.md`、`specs/ux-traceability.json`、`docs/employee-surface-contracts.md`、`docs/21-admin-employee-page-roles.md`、`docs/design-system/kol-workbench/MASTER.md` 与未跟踪的 `docs/DESIGN.md` OpenAI 风格参考。

## 覆盖面

已逐一核对 `App.tsx` 的 19 个路由入口：Home、Chat、Pipeline、Cron、Skills、Agents（含详情）、Teams、Knowledge（含 market）、SkillHub（catalog/partners）、Exam、Approvals、Settings、ConnectorUse、AdminConsole（employees/agents/connectors/skills/approvals/exams/data/knowledge/kol 及详情）、Share；同时核对 Workbench、AuthGate、UserMenu、ComposerDock、RunHud、SideWorkbench、Discovery、跟进卡和管理子组件。

## 已确认符合

- `node backend/scripts/validate-contracts.mjs`：`status=valid`，无 errors/warnings；10 个 KOL FS、9 个 UX 追踪项均有结构化映射。
- `npm run build`（frontend）：TypeScript 检查通过，Vite 生产构建通过；仅有 814 kB JS bundle 的性能提示。
- Home/Chat/Pipeline 的任务脊柱、阶段与发送分离、等待/失败文案、Admin 路由服务端可用模式门控，符合宪法的页面职责方向。现有 E2E 覆盖 Home 四面板、发现确认闸门、失败映射、Composer 输入等关键路径，但不等于所有页面体验验收通过。
- OpenAI 参考的白色画布、近黑文字、克制边界、排版优先方向在基础 token 与页面结构中部分存在；现行 MASTER 的靛蓝/语义色优先级仍是项目事实来源。

## P0/P1 确定问题

### P1：基础设计系统被页面局部样式越权，视觉不符合 OpenAI 的克制原则

触发：打开 `/kb`、`/market/kb`、`/market/skills` 或部分状态卡。  
证据：`frontend/src/styles.css:4561` 起定义 `--kb-accent: #ea5504`、多处 `#fff4ee/#fff8f3`，并在 `:4690` 起使用硬阴影；`:5988-6129` 使用黑色实底、彩色渐变 orb 和多套局部色；全文件存在大量未映射十六进制值。  
规则：MASTER §2/§5 要求组件使用语义 token；CONSTITUTION §3 禁止与设计系统冲突的颜色、圆角、间距；`docs/DESIGN.md` 要求黑白灰、单一强调、极少装饰。  
影响：同一工作台在知识/市场页面出现橙色品牌皮肤、渐变和硬阴影，破坏跨页层级与 OpenAI 风格，也使颜色不能稳定表达状态。  
建议：把局部色迁移到核心语义 token（或先经评审新增 token），去掉渐变与装饰性 orb，保留一个主动作；用边框/留白取代硬阴影。此项需要视觉回归后再改代码。

### P1：存在无替代的 `outline: none`，违反键盘焦点底线

触发：键盘聚焦知识库隐藏/关闭控件、SkillHub 搜索输入或相关交互。  
证据：`frontend/src/styles.css:2863`、`:4760`、`:5967` 明确移除 outline；其中 `:4760` 位于 `.kb-hide-option:focus-visible`，会直接消除该控件焦点环。  
规则：CONSTITUTION §6；MASTER §6 要求不得无替代移除 `outline`，所有操作可键盘完成且焦点清晰。  
影响：键盘用户无法判断当前控件，WCAG 2.2 AA 焦点可见性风险。  
建议：删除 `outline:none`；统一使用 `outline:2px solid var(--focus-ring); outline-offset:2px`。若需要视觉重置，改用边框/阴影但保留可见焦点。

### P2（仅当窄视口 Web 继续作为支持范围时）：响应式侧栏缺少焦点回收

触发：桌面 Web 窗口缩窄到 ≤860px 后点击 Workbench 的“打开导航”按钮。项目没有独立移动端页面或移动 App；这里检查的是同一 Web 页面在窄视口下的 CSS 响应式分支。  
证据：`frontend/src/layout/Workbench.tsx:96` 只切换 `mobileOpen`；`frontend/src/layout/Workbench.tsx:99-104` 仅通过 class 显示侧栏，没有 dialog/menu role、遮罩、Escape 关闭或关闭后将焦点返回触发按钮。  
规则：CONSTITUTION §6；MASTER §6/§7 的 Dialog/抽屉焦点和响应式要求。  
影响：若产品承诺窄视口 Web 可用，键盘焦点可能落到被遮挡内容，读屏用户不知道导航状态边界。若本产品明确只支持桌面宽屏，该项不构成发布阻断。  
建议：先确认产品支持范围；若支持窄视口 Web，再补按钮 ref、首项聚焦、Escape/遮罩关闭和关闭后回焦，并补 360/768 视口 E2E。

### P1：`UX-FOLLOWED-KOL-CARD` 尚未进入追踪矩阵，不能宣称体验验收通过

证据：`specs/UX-FOLLOWED-KOL-CARD.md:123` 明确“暂不新增已追踪 UX ID”；当前 `specs/ux-traceability.json` 只有 9 项，未包含跟进卡契约。  
规则：docs/README 验收流程要求每个交互有 UX/FS/测试追踪证据。  
影响：跟进卡即使已有实现，也只能标记为“规格存在”，不能作为发布体验通过项。  
建议：将契约条目拆成可执行 UX ID，绑定 `FS-KOL-006/010`、红线测试和 E2E，再更新追踪矩阵。

## P2 / 风险与缺口

- 生产构建的 JS 入口约 814 kB，Vite 报超过 500 kB；市场/管理等低频页面可按路由懒加载，避免首屏性能风险。该项是优化建议，不是宪法违约。
- `Workbench` 的响应式窄视口导航按钮使用 `☰`（`Workbench.tsx:96`）。按钮已有中文 `aria-label`，功能可用；但 MASTER 禁止 emoji 充当产品图标，若保留该分支建议换统一 SVG 图标。
- `frontend/src/styles.css` 约 6626 行，局部魔法颜色与旧迁移别名很多；应分批清理，不要在本次扫描中机械替换，以免改变状态语义。
- 现有自动化主要集中在 Home/Composer；尚未发现覆盖所有路由的 360/768/1024/1366/≥1440 视口、键盘回归和 reduced-motion 证据。因此“契约校验通过”不能等同于“全页面体验验收通过”。

## 结论

本轮扫描未发现可以仅凭前端代码断定的权限越权或把发送隐式推进阶段的 P0 违约；后端契约校验通过。当前发布前必须优先处理焦点可见性、局部视觉越权，以及为跟进卡补齐 UX 追踪证据。响应式窄视口侧栏仅在产品支持该 Web 形态时纳入修复范围。OpenAI 风格应作为视觉方向使用，但不得覆盖现行 MASTER token、权限和真实状态契约。
