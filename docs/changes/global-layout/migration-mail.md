# 通讯页布局迁移报告

## 范围与依据

- **路由：** `/mail`（既有查询参数 `c`、`m`、`p`、`box` 原样保留）。
- **实际修改：**
  - `frontend/src/pages/Mail.tsx`
  - `frontend/src/pages/global-layout-mail.css`（新增，仅由 `Mail.tsx` 导入，所有选择器以 `.mail-page` 限定）
- **未修改：** 路由、请求、数据读取、权限、阶段变更、确认、发信、同步、错误文案、共享组件、`styles.css`、其他页面。
- **已阅读并遵循：** `docs/CONSTITUTION.md`、`docs/TECHNOLOGY.md`（FE/TEST）、`docs/DESIGN.md`、`docs/ia-information-architecture.md`、批准计划 `deliverables/kol-global-layout-goals-plan.md`，以及 `components/InformationLayout.tsx` / `information-layout.css` 与现有设计 token。

## 完成的最小迁移

1. **邮件详情短属性 → `PropertyList`**
   - 将详情标题下原本串联的联系人与邮箱，改为 `PropertyList` 的语义 `dl/dt/dd`。
   - 采用 `labelWidth="short"`；共享组件使用 `--property-label-w-short` 和 `--property-label-gap`，后者在现有 token 中为 **24px**。标签左对齐、值左对齐；窄容器仍由共享组件按实际容器收敛。
   - 联系人/邮箱成为主题下方的完整详情层，不与主题同行争抢空间；邮箱不存在或与联系人文本相同的既有条件仍不重复显示。

2. **邮箱状态记录 → `RecordRow` + `ActionGroup`**
   - `邮箱状态`、真实同步状态、未读数与既有收取/取消同步/刷新状态/重试同步动作使用一条 `RecordRow`。
   - 普通状态记录维持共享默认 **40px** 记录基线及 **13px** 主文字；状态与动作不再依赖分散的普通 `div` 布局。
   - 已保留 `data-mail-box`、`data-mail-sync`、`data-mail-entry="sync-mailbox-mail"`、禁用条件、轮询和原有回调。

3. **会话动作 → `ActionGroup`**
   - 原文折叠层中的回复、生成回复、快速分析和“更多”菜单改由共享 `ActionGroup` 承载。
   - 所有原按钮、确认/发送前流程、禁用逻辑、菜单引用和 `data-mail-thread-actions` / `data-mail-reply` / `data-mail-draft-reply` / `data-mail-analyze` 均保留。

4. **长主题可达 → `TruncatableText`**
   - 阅读区固定头的主题使用共享 `TruncatableText`；有溢出时可通过键盘/点击“展开”读取完整主题，而非只依赖悬停标题。
   - 页面局部 CSS 仅处理该共享组件与现有阅读头的协调，保持 13px 标题基线和可见展开入口。

## 已合规保留

- 本页没有需要保留为 `Table` 的数据表；没有把已有表格改为 `div` 列表。
- 会话树、联系人行和邮件时间线由既有 `CorrespondentRow`、`ConversationItem`、`MailTimelineItem` 承载，保留其专业树/选择/已读交互，不在 `Mail.tsx` 强行再套一层记录行。
- `MailFold` 中的摘要、中文翻译、原文保持“摘要/按需展开/正文”的分层；未将正文压缩为单行。
- 合作阶段选择器不是 Ant Design `Form`，且提交后仍进入既有会话确认、不直接修改阶段；为避免改变校验、确认或风险语义，未牵强改为 `HorizontalForm`。
- 原有加载、接口缺失回退、读取失败、线程错误、无绑定邮箱、同步失败、禁止状态和外发相关风险提示均未隐藏或替换。

## 必须多行的例外

| 区域 | 保持多行的原因 |
|---|---|
| 原文、中文翻译、AI 往来摘要 | 阅读性和完整事实优先；由既有折叠层按需展开。 |
| 线程读取错误、接口未开通回退、无绑定/无匹配提示 | 真实异常与恢复路径不能为单行密度被省略。 |
| 合作阶段说明及目标阶段选择 | 包含正式阶段变更的确认边界；必须保留说明与既有选择控件。 |
| 展开的会话树和邮件时间线 | 是层级浏览与逐封选择的详情层，不是普通平铺记录。 |

## 尚未覆盖范围与限制

- 受“仅修改 `Mail.tsx` / 本页局部 CSS”限制，未更改 `mail/components/*` 中的会话树与时间线内部 DOM；这些区域的进一步 `RecordRow` 迁移需单独授权对应组件文件。
- 未更改共享 `InformationLayout` 或全局 token / `styles.css`。
- 未运行共享浏览器、E2E、真实用户测试，也未声称全站、真实用户或生产验证通过。
- 未执行部署、发信、数据库写入、SSH、Git 提交或生产操作。

## 本地检查

- **通过：** 使用全局 TypeScript 编译器的 `transpileModule` 对最终 `Mail.tsx` 做 TSX 解析检查；无解析诊断。
- **通过：** `global-layout-mail.css` 括号结构检查通过。
- **未通过（环境依赖阻塞，非通过声明）：** `npm run typecheck` 尝试执行后失败。当前工作区缺少 `react`、`antd` 与 `react/jsx-runtime` 类型/模块，TypeScript 汇总为 **242 个文件、19,665 个错误**；因此不能将其报告为类型检查通过，也不能据此断言页面级完整类型回归。

## 审查结论

本次仅调整通讯页的展示结构：短属性采用批准的标签—24px 留白—值模式；一个普通邮箱状态记录采用标题—状态—动作同行模式；长主题和长正文保持可达的详情分层。未在前端推断权限、阶段、审批或发送结果，符合展示层不得替代后端业务与风险闸门的边界。
