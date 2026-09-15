# 视觉系统迁移索引

> 本文件不再定义任何视觉法律、默认栈或优先级。现行视觉入口是 `docs/design.md`（class I）；token 源仍是 `design-system/kol-workbench/MASTER.md`，单页覆盖为当前 `pages/*.md`。该目录名是 KOL 试点皮肤路径，不是「产品只做 KOL」。

## 用途

- 查找旧 token、旧 class 或视觉决策的迁移背景。
- 定位历史设计方案：`references/legacy-visual-design-system.md`。
- 追溯正文 16px、语义色和缩放禁令的原始记录。

## 禁止作为实施依据

- 不从历史文件继承 Linear、shadcn、旧 Composer 造型或现有页面布局。
- 不从历史文件复制颜色、字号、间距、滚动或组件规则。
- 不使用历史文件解决新旧文档冲突；冲突按 `CONSTITUTION.md` 的优先级处理。

## 当前入口

1. `docs/design.md`（用户锁定的视觉入口；禁止在此复制 hex）
2. `CONSTITUTION.md`
3. `CONTEXT-MANIFEST.md`
4. `design-system/kol-workbench/MASTER.md`（token 源）
5. `design-system/kol-workbench/pages/<当前页面>.md`
6. 对应 FS / `UX-EMPLOYEE` 硬不变量
7. 导航 / 一页一问：`ia-information-architecture.md`
