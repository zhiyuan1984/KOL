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
