# 管理连接器紧凑列表实施记录

## 需求与授权

2026-10-10 用户确认方案：管理侧连接器按单列列表展示，桌面 36px 行高、20px 图标、14px 名称；状态使用无边框文字按钮；列表移除类型、凭据、验证与更新时间、接口数量及重复勾选。保留名称/状态打开配置向导、配置按钮、工具抽屉和详情入口。用户已授权验证后提交 main、push、deploy。

## 审查记录

需求 → UI/UX 专家、前端专家、测试经理 → CONST-04/05/08/10 → TECH-FE-01/03、TECH-TEST-01/02/03/04 → 符合；仅修改管理列表呈现，不修改权限、审批、连接器数据和执行风险闸门。真实状态仍消费原有 governanceStatus。

尺寸登记：36px 行高、20px 图标与 14px 名称来自本次明确确认的展示规则，限于 .connector-list 的局部语义变量，不修改全局视觉 token 或文档法条。其余颜色、控件、间距、焦点、字体复用已有设计系统。

## 实施资产

- frontend/src/admin/connector/ConnectorHub.tsx：管理列表独立渲染分支；移除列表明细和重复勾选；状态 Ant Design text button；显式可访问详情链接；保留 data 选择器与配置/工具焦点返回。
- frontend/src/admin/connector/connectorAdmin.css：独立 .connector-list 样式；替换两轮密度补丁；门户弹窗搜索框精确区分外壳和内部 input，不再使用无法命中的 #root 选择器。
- frontend/e2e/connector-list-density.spec.ts：新增六项尺寸、对齐、长文本、移动端触控与交互用例。

## 验收证据

命令：

```sh
npm run build
E2E_SKIP_BUILD=1 npx playwright test e2e/connector-admin.spec.ts e2e/connector-list-density.spec.ts --project=chromium --reporter=line
```

结果：22 passed，3 skipped，0 failed。三项跳过为原有 auth-enabled 写入用例；本次未改变服务端写入路径。构建包含 TypeScript 检查；git diff --check 通过。

实际本地页面 Chromium 1280/1440/1920 宽：每条行高 36px、图标 20×20px，状态边框 0px，列表元数据节点 0，列对齐且操作可见。375px 宽：无横向溢出，核心操作触控目标至少 44px。长名称/用途有省略及完整 title，不挤掉操作。

交互检查包括筛选、名称/状态/配置打开向导、Esc 关闭与焦点返回、工具抽屉、键盘跳转详情；浏览目录原有 32px 搜索框和 28px 图标契约通过。

## 验证范围与已知环境限制

本地使用项目既有 stub E2E，部分 UI 断言使用明确测试夹具，不能据此声称真实 MCP 调用或数据库写入已验证。本地未配置 DATABASE_URL，出现与本次呈现无关的 PostgreSQL 日志告警；无新增浏览器 pageerror，连接器界面契约均通过。生产验证另核验运行版本、静态入口和实际页面。

## 发布检查

提交 main 前确认远端最新版本，不覆盖其他改动；部署按 scripts/deploy.sh --sync。核验 systemd WorkingDirectory=/home/ecs-user/kol、版本 API、HTTP HTML 静态资源引用以及线上截图与行高。回滚使用上一个提交及部署脚本保留的 dist.prev，不删改业务数据或凭据。
