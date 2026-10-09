# KOL 三入口高密度卡片统一验证

日期：2026-10-09。依据：用户图 3、已批准《KOL卡片统一目标与实施计划》及 `docs/DESIGN.md` §§24.6、26.3、27。

## 目标与实现

“我的红人 / 公海 / AI 发现候选”使用同一组 `components/kol` 生产组件和唯一 `kol-card.css`；不再以三套 legacy 根类分别覆盖头像和卡片布局。

- `KolCardShell`：全宽信息行；identity / meta / review / actions / evidence 共用布局原语。
- `KolAvatar`：项目既有 Ant Design Avatar，24×24px，6px 控件圆角，真实图片 `cover` + 居中，无描边；缺失或加载失败用名称首字，不制造人物画像；URL 或对象变化恢复图片读取。
- `KolCardSelection`：Ant Design 6 Checkbox，实际 `.ant-checkbox` 14×14px。
- `KolFactIcon`：统一 Ant Design 指标和动作图标，14px。
- `KolAction`：Ant Design `type="text"`，细指针 24px；名称 / 操作 13px，辅助信息 12px，数值 13px；名称权重 500。
- 卡片内边距 8px，行间距 4px；正文不为头像或右侧操作永久留出空列。简短理由和动作可自然并排；容器不足时换行；<480px 移至正文下方。
- 粗指针交互目标 ≥44px，彼此不重叠，头像仍为 24px。支持浅/深主题、reduced motion、键盘展开证据和摘要全文。
- 项目既有 `TaskTheme` 在结果区提供 token 主题，不创建逐卡独立主题。
- 退休 `styles.css` 中无调用方的 163 项旧卡片/头像选择器及候选专属重复 CSS；保留 Home 框架、会话几何、工具栏和所有仍有调用方的规则。

## 行为边界与最小修正

API 路径、参数、快照版本、权限、领取、跟进、忽略、入库、阶段建议和邮件事实不改。我的红人原有键盘/意图悬停强调与防滚动抢焦点保持；已有单行 R3“跟进”为即时受控命令，不新增虚假的确认步骤。

回归中恢复三项已有失效测试后，暴露批量“确认入库”同帧双击发送两次的呈现层 re-entry 问题。`DiscoveryCandidateBatch` 和 `DiscoveryRuntimeCandidate` 增加同步 `useRef` busy 锁，保留原确认、取消、错误恢复和回执逻辑；单行/批量双击只提交一次。未改后端或改变任何业务规则。

旧发现测试在未修改的 `2254b59c` 同样存在三项失败：过时确认按钮名、旧批量 data 属性、已不存在的内容网格。更新为真实按钮 accessible name、对象/操作明细和共享全宽布局；取消零写入、快照和单次提交断言均保留并加强，不降低几何或可访问性阈值。

## 审宪 / 基本法

- CONST-04：前端呈现与同步防重复点击，不改变业务策略、权限、审批、阶段自动化或外部工具契约。
- CONST-08：先核查宪法、技术、信息架构及 DESIGN，受用户批准实施。
- CONST-10：不补造头像、缺失指标、联系方式或请求成功。fixture 明确隔离并拦截 `/api/**`，不代表生产业务事实。
- DESIGN：默认 L3 文字动作；沿用既有一个焦点 CTA 强调例外，不让全部卡片成为实底主按钮；AA 白字强调使用既有深蓝职责 token。尺寸、间距、字阶、圆角使用项目 token。
- `docs/DESIGN.md` 登记新的唯一呈现归属及旧类退役，避免后续 Home 补丁再覆盖共享卡片。

## 验证

实施基线为 `2254b59c`。完成期间 main 新增 `67378495` 的邮件阶段建议/证据呈现，修复已无冲突重放在其上；原邮件组件、工作区样式、工作流及新增邮件样式块完整保留。以下以重放后的 build、共享卡片及相关呈现测试为准。

已完成的专项验证：

| 检查 | 结果 / 覆盖 |
|---|---|
| `npm run build` | 最新 main 整合后通过；包含 TypeScript 检查，Vite 仅有大 chunk 提示 |
| 共享组件、KOL 契约与公海模型单测 | 21 / 21 通过 |
| 三卡片隔离真实组件回归 | 9 / 9 通过 |
| 相关呈现整合回归 | 76 项：发现/Home 接入 38、任务/会话 26、并发邮件证据 12；初跑 75 通过，1 项 SSE 事件时序等待修正后浅/深重复 4 / 4 通过 |
| 五 Tab 几何 / 浅深主题保护 | 2 / 2 通过 |

SSE 测试原先在设置 `scrollTop` 同帧立即注入下一条流事件，可能先于原生滚动监听更新跟尾意图。测试增加“已达底部”的显式断言与两个 `requestAnimationFrame` 等待，再注入事件；不改生产滚动代码，也不降低 ≤1px 阈值。浅/深主题各重复执行 2 次，共 4 / 4 通过。

矩阵：容器 360、479、480、719、720、820px；视口 375、768、1100、1101、1440、1920px；短窗口、200% CSS zoom、粗指针、浅/深主题和 reduced motion。共同几何误差 ≤1px，卡片与页面无横向溢出。标准公海/候选宽容器行高严格 <120px；有额外事实或长内容的我的红人卡片可自然增高，不裁掉事实。

复用命令：

```bash
cd frontend
npm run build
npx vitest run --config vitest.kol-presentation.config.ts
npx playwright test --config playwright.kol-cards.config.ts
npx playwright test --config playwright.kol-regression.config.ts
npx playwright test --config playwright.ui-unify.config.ts
```

后台/生产数据库全量测试不在本次呈现验证范围，不宣称完整 CI release-gate 已通过。真实生产上线核验只执行 GET、页面导航、DOM 几何读取，不点击任何领取、跟进、入库、忽略、发信或阶段变更。

## 发布和回滚边界

使用活动目录和旧 SHA 守卫、备份 tracked overlay/未追踪源码哈希/旧 dist/进程 ID；不执行 `git reset --hard`，生产非本次覆盖层保持。仅交集候选行暂存原覆盖并重放；所有后端、数据库、环境、systemd 路径和 worker 源码不变。构建完成后换前端资源，保留旧 content-hashed assets 供已打开页面请求；仅刷新 Web 版本缓存，不重启 outbox 或执行 worker。失败自动恢复旧 HEAD、原候选 overlay 和旧 dist。

公网 `/api/version` 和 `/ui-release.json` 用于分别核验运行版本与卡片前端源 SHA，避免“main 有变更、线上仍显示旧卡片”的误判。生产实测 SHA、备份路径及最终截图另见交付回执。

## 上线后真实作用域补充核验

首轮 `ac91395d` 生产只读核验确认头像 24px、圆角 6px、cover、名称 13px/500、Checkbox 14px 和无溢出均正确，但辅助字号实测为 13px。原因是旧 `#root .workbench :where(:not(svg):not(svg *))` 带 `font-size: 13px !important`，还会压平共享卡片的 12px helper 与 14px icon。

最终修正：该 shell 重置仅排除 `.kol-card-row` 及其后代，其余工作台样式保持；KOL 字階仍只由 `kol-card.css` 和原有 token 管理，不在共享组件反打 `!important`。三组件 fixture 增加真实 `.workbench` 宿主；真实 Home 回归补辅助 12px、状态 12px、图标 14px 断言。新版本上线后再次读 DOM 核验，而不是只凭隔离截图判断完成。最终源 SHA 和实测值见交付回执。

最终作用域补测：带真实 `#root .workbench` 的三卡片矩阵 9 / 9 通过；真实 Home 字阶/选择、领取取消、焦点保护 3 / 3 通过；补测发现呈现与密度 36 项通过，SSE 前提同步进一步包含初始阅读位置恢复，并发浅/深重复 4 / 4 通过；最终 TypeScript + Vite 构建通过。Home 的两条 meta 行逐一断言，状态通过既有 `data-stage-label` 定位，不假定业务组件都复制同一 class。

逐个生产图标检查还覆盖到资料不足建议态：警告图标会成为 `span:first-of-type`，旧建议正文选择器错误把它指定为 13px。建议正文改为显式 `kol-card-suggestion-title`，警告图标继续由 `--icon-sm` 唯一负责；新增真实组件的 `insufficient=1` 呈现输入 fixture，分别断言图标 14px、正文 13px、原因 12px，并检查三入口所有指标图标。只改角色选择器，不改推荐、事实或业务策略。

最终条件图标专项：三组件全套 10 / 10 通过（含资料不足建议态），真实 Home 接入/取消/焦点 3 / 3 通过，TypeScript + Vite 构建通过，共享组件/KOL契约/公海模型单测 21 / 21 通过。

## 2026-10-09 补齐全入口迁移（本轮 0Gn7KCEK）

### 方案定位与审查

用户指定的 `/home/ubuntu/kol-card-plan/KOL卡片统一目标与实施计划.md` 在本轮当前沙箱不存在；按仓库已登记的同名批准方案、DESIGN §24.6/26.3.1 与本文件的实现记录续作，不伪称已读取原文件。进入时 main 已有 `ac91395d` / `9664c023`，工作期间并行补丁 `8703ffef` 已上线；本轮不重复这些工作，补齐实际遗漏。

需求 → 三入口及全部候选呈现分支统一、死样式清理与发布；主责 → 前端、UI/UX、测试；宪法 → CONST-04/05/08/09/10；基本法 → TECH-FE-01/02/03、TECH-TEST-01/02/03/04；结论 → **符合**。沿用原受控确认、回调、快照和深链，不重写归属、权限、阶段或后端执行规则。

### 实施资产与真实缺口修正

- `DiscoveryResultPane` 在 `!startAction && showResults` 时仍挂载旧 `DiscoveryLeadRow`，此前三个目标组件通过不代表全部可达分支已迁移。本轮将该行迁移到 `KolCardShell/KolAvatar/KolCardSelection/KolFactIcon/KolAction`；保留原 `onIngestCandidate/onFollowUpCandidate/onIgnore` 与 `run_id` 上游回调，未替换为不同的运行时命令接口。
- 旧分支仍在行内确认后执行入库/跟进，取消零回调；失败保持确认并可重试。增加同步 busyRef 防止同帧确认重复进入，属于呈现层重入保护，不替代后端幂等或授权。统一头像为真实源图/中性首字回退，移除卡通人物占位。
- `kol-card.css` 补定义列表证据、错误语义样式，其余行布局沿用共享原语。
- PostCSS AST 删除 **146 条完整旧规则、178 个旧选择器分支**，6 条混合规则保留活分支；移除 14 条死块注释与 1 个空 media。文件为 `styles.css`、`home/followed.css`、`home/workspace/agent-session.css`、`home/discovery-workspace.css`。保留活的工具栏、列表、选择、确认、undo、全局 chip 与会话框架。
- `npm run check:kol-presentation` 验证 **4 个呈现入口**均实际使用共享外壳与头像，并通过 PostCSS 检查退役类不能重新进入相关样式。
- 单测额外验证 `DiscoveryResultPane` 的旧运行结果分支真实挂载共享行；不是仅以文件字符串或单卡fixture代替宿主接入验证。
- 新增旧分支浅/深主题 × 6 容器宽度的浏览器验收及行内确认/取消/失败重试/缺联系方式禁选测试。所有动作在隔离回调或 `/api/**` 拦截中验证，不进行生产外部写入。

### 验收修正说明

最终呈现整合回归初跑 75/76，通过之外的一项是几何用例撤销 API fixture 后旧页仍在轮询，使下一入口落到不存在的本地后端。修正为先导航 `about:blank` 卸载旧页，再 `unrouteAll`；不修改生产代码、目标地址、业务状态或几何阈值。修正后重跑结果以本轮交付回执和完整日志为准。

### 发布约束

活动目录不等于 `~/kol`，以进程/systemd 的实际目录为准。活动源码包含其他任务的前端、共享契约与后端覆盖层；本轮从活动前端源码快照叠加限定文件构建，校验快照未漂移后以 patch 更新本次文件、保留其余 tracked/untracked 工作。只切换前端 index/新 hash assets 与 `ui-release.json`，保留旧 hash assets；不执行 `deploy.sh --sync` 的 hard reset，不重启后端、Outbox 或 execution workers。因此后端 `/api/version` 的进程缓存可能仍为旧 SHA，前端发布版本由 `ui-release.json.source_commit` 与实际入口资源哈希共同核验，不把前端版本误报成后端代码升级。

后台生产数据库全量 release-gate 不属于呈现验收，本轮不声称完整业务 CI 已通过；覆盖的是上述全部卡片呈现入口、相关确认/恢复边界与浅深/宽高/输入模态矩阵。
