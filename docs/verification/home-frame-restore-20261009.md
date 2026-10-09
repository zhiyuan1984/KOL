# Home 桌面布局局部恢复（2026-10-09）

## 需求与根因

用户要求恢复被后续生产部署工作区覆盖的五 Tab 视觉补丁布局部分。`main@8d4dd994` 包含 `6b27dcc9`，antd-visual.css 引入及内容未丢失；真实活动目录的未提交 styles.css 却将 Home 的顶部 4px 退回旧宽度例外：`width:100%; max-width:none`。线上实测顶部为 20px。

仅修复这一段 Home 桌面规则，保留任务中心、知识库、后端及所有其他生产差异；不整份覆盖 styles.css、不 reset --hard、不迁移独立会话地址。

## 审宪

需求 → 局部恢复 Home 桌面布局，满足已交付补丁要求。

主责角色 → 前端专家、测试经理、发布运维。

宪法条款 → CONST-04（只改呈现）、CONST-08（此记录）、CONST-10（区分模拟测试与实际部署）。

基本法条款 → TECH-FE-03（独立会话地址保持）、TECH-TEST-01/02/03/04（适用回归、实际证据及回滚）。实施细则 → DESIGN §6/10/11（布局与三轴适配）、§27.2（AI发现及独立会话既有固定内容轴）。

结论 → **符合**。`--space-1` 恢复顶部 4px，`--content-max` 显式收敛 shared-frame 上限；AI发现保留更高优先级的 §27.2 会话布局。未改动业务、权限、内容、路由或主题颜色。

下一步 → 验证后提交 main、push；备份真实活动目录，只替换匹配到的一段旧 Home CSS，重新构建、部署、核验公网版本与实际 DOM。

## 完整运行代码（本次替换块）

```css
/* Home desktop frame: one top inset and an explicit shared content cap.
   Do not restore the legacy width:100% / max-width:none exception here.
   DESIGN §27.2 agent-session geometry retains its more-specific discovery
   override in workspace-shell.css; independent session routes are unchanged. */
@media (min-width: 1101px) {
  .home-pane[data-home-workspace] .home-stage {
    width: min(100%, var(--content-max));
    max-width: var(--content-max);
    margin-inline: auto;
    padding-top: var(--space-1);
  }
}
```

## 验证证据

- `git diff --check` 通过。
- `npm run build`（TypeScript noEmit + Vite）通过。
- 加强后的 ui-unify-smoke：浅/深主题 2 项通过，5 Tab × 7 宽度 × 2 主题，共 70 个组合。
- 宽度：375、768、1100、1101、1280、1440、1920px；新增桌面断点两侧、四 Tab 显式 max-width 与居中断言，保留 AI发现会话例外。
- Home任务与独立会话回归：首次 25 通过、1 项 CSS 过渡颜色时序失败（透明色收到 0.008 alpha）；失败用例在未修改测试断言下单独复跑通过。不得报告为首次整套零失败。
- 所有 E2E 使用拦截 fixture，没有调用生产外部工具，不证明业务写入闭环。

## 生产保护

活动目录：`/home/ecs-user/kol-releases/task-operations-EXRuCX5v`。采用既有人工发布 `[skip ci]` 方式，避免自动流水线对非活动旧目录做破坏性同步；不代表全量 release gate 已验证。

部署前备份原 SHA、tracked patch、styles.css、未跟踪源文件校验和旧 dist。局部替换后：

1. styles.css 除所匹配 Home 块外所有字节必须不变。
2. 除 styles.css 之外的 tracked diff 必须与部署前完全一致。
3. 未跟踪源文件逐一 SHA 校验。
4. 不切换活动目录、不移动生产 HEAD、不加载并发提交的新后端；只在当前前端源码中恢复该 Home 块并构建。
5. 构建失败或健康失败自动恢复原 styles.css 和旧 dist；全部服务 PID 必须保持不变。

服务器备份：`/home/ecs-user/kol-release-backups/home-frame-20261009-1521`。

提交前检测到 main 并发新增任务中心提交，修复已无冲突重放至 `c8bcb9c1` 之上。该任务另有独立发布计划，本次不抢占其后端/Worker发布。main 的修复提交与生产运行时 SHA 必须分别报告；仅前端热发布后运行时版本仍为 `8d4dd994`，不代表 CSS 没有更新。

## 保留范围

antd 主题、原 AA 对比度修正、AI发现 400px 智能体内容轴、独立 session、任务中心与知识库改版全部保留。后续 Home patch 合并仍以本次 CSS 为准；不要携带旧工作区的 Home 宽度例外。
