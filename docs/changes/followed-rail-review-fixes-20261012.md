# 我的红人页评审修正：工具行、全选三态、筛选空态与默认邮箱恢复（2026-10-12）

## 目标和范围

按评审标注修正「我的红人」页四项：排序控件去框降高、全选三态、点击建议链接误报绑定、已连接邮箱无法恢复默认。
只改该页右栏工具行样式、空态判定与 `user_starry_bindings` 的默认恢复写路径；不改阶段、审批、发信政策和前端对绑定的判定权属。

## 实现

- **排序控件（L3 文字按钮组）**：删除右栏工具区对 `.followed-object-sort` 的描边盒、底色与 `--control-h-lg` 加高覆盖，
  以及选中项 `--ds-selected-bg` 胶囊；由 `home/followed.css` 的 L3 基础样式接管（无框、28px、hover 淡底、选中 `--accent-text` + 600）。
  工具行高度回到与搜索框一致（32px，`--control-h-lg` 是搜索框的登记值）。该页注释本来就写明排序是 L3 文字按钮组，本次是回归登记样式。
- **全选三态**：右栏全选框在「部分可见对象被勾选」时显示 `indeterminate` 中间态，不再表现为纯未勾选；文案维持 `已选 N`。
- **筛选空态优先**：`followEmptyKind` 里「有名单（rows>0）→ filtered」提到绑定判定之前；绑定/过期引导只在真·空名单时出现。
  「去绑定/重新连接」按钮改按有效空态门控，并加 `data-follow-bind` 供回归测试定位。
- **默认邮箱恢复路径（实现缺口修复）**：`saveStarryBinding` 在「本人当前没有默认邮箱」时，把保存的邮箱设为默认（显式选择）；
  已有默认时不变（加邮箱不夺默认）。`starryBindingRow` 的严格默认读取与「解除默认不自动改用其他邮箱」语义保持不变
  （BIZ-04：不得默认第一只邮箱、不得回退到其他邮箱）。

## 规则缺口与保守处置

`7c663fe9`（任务优先设置与显式默认）把绑定范围收紧为「只认显式默认」，但 `saveStarryBinding` 仅在首次绑定写
`is_default`，且 upsert 不更新该列；解除默认后所有行为 0，本人经界面重选也无法恢复 —— 属实现缺口，不是新规则。
本轮按 BIZ-04 精神只补「无默认时的显式保存成为默认」这一条写路径；不为存量账号自动提升默认（避免代替本人做出
「哪只是默认」的选择），由本人到「设置 → 绑定跟进邮箱」重新保存即可恢复；也不引入数据库 schema 迁移。

## 验证策略

- 后端：`npm run typecheck` + `starry-bindings-migrate`（SQLite 套件）新增用例：绑定 A → 绑定 B → 解除 A（无默认、
  范围判未绑定）→ 重新保存 B → 默认恢复、`starryBindingRow` 可解析；再加一只仍不移动默认。既有
  `identity-starry-bind` / `kol-settings-routes`（PG 套件）在发布门禁环境一并回归。
- 前端：`npm run typecheck`；Playwright（stub 自起服务）跑 `home-followed-rail-layout`、`home-followed-memory-projection`、
  `home-followed-legacy-projection`、`home-surface-failure`、`home-chat-send-ne-stage`，并新增：全选三态断言（未勾选/中间态/全选/取消）、
  「有名单 + 服务端未绑定 → 点建议链接显示筛选空态、无 `data-follow-bind`」。既有断言先跑基线对比，不为转绿改法。
- 生产只读核对（部署后）：`/api/me/starry-binding` 恢复 `bound:true`；我的红人页无绑定误报。

## 发布与回滚

前端样式/文案 + 后端单函数改动，无 schema 迁移。发布走现有流程（构建新资产、原子替换、重启 API）；
回滚为回退提交并替换 `dist`。部署后本人重新保存 `larry.zhao@amperetime.com` 恢复默认。
