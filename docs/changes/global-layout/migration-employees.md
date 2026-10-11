# 管理人员目录迁移记录

## 范围与实际路径

- 页面实现：`/home/ubuntu/kol-global-impl/frontend/src/admin/employees/EmployeeDirectoryV2.tsx`
- 本页局部适配样式：`/home/ubuntu/kol-global-impl/frontend/src/pages/global-layout-employees.css`
- 本记录：`/home/ubuntu/kol-global-impl/migration-employees.md`
- 保持未改：共享组件 `frontend/src/components/InformationLayout.tsx`、其 CSS、`frontend/src/styles.css`、现有 `employee-directory.css`、路由、接口、确认逻辑、数据模型和测试文件。

已依据 `docs/CONSTITUTION.md`、`docs/TECHNOLOGY.md`（FE/TEST）、`docs/DESIGN.md`、`docs/ia-information-architecture.md` 及批准计划 `deliverables/kol-global-layout-goals-plan.md` 完成本页展示迁移。该任务仅调整阅读结构；没有请求生产接口、写入数据、部署、提交 Git 或启动浏览器。

## 最小迁移

1. **员工目录的非表格记录**改为共享 `RecordRow`：员工姓名/工号、账号状态、行内动作在宽容器的同一主行；姓名使用 `TruncatableText`，超长时有可点击的完整文本入口。
2. **状态与动作职责分开**：账号状态现在以不可点击的“已启用/已停用”文本状态呈现；编辑、管理绑定、启用/停用保留原有按钮、字段值、确认、请求和错误路径，并由共享 `ActionGroup` 组织。
3. **详情分层**：企业邮箱进入 `RecordRow.detail` 的 `PropertyList`，复用共享属性列的短标签宽度与 `--property-label-gap`（24px）中间留白；不把邮箱、Agent 来源或异常信息删除以换取单行。
4. **管理绑定弹窗**：现有可用 Agent 记录和试算新增覆盖记录复用 `RecordRow`；每个 Agent 的来源改为 `PropertyList`。直接绑定的撤销入口、继承来源的只读提示、试算/确认及其原有 `data-*` 标记均保留。
5. **局部样式**仅在 `[data-admin-employees]` 或本页的 `[data-employee-dialog='bind']` 下生效，使用既有设计 token；没有改动共享样式或全局样式。

## 已合规并保留

- 标准数据表没有改为 `div` 列表；`EmployeeDirectoryV2.tsx` 的目录本身原为非表格记录容器，故仅迁移该容器内的记录呈现。
- 组织层级筛选、品牌/状态单选、搜索、新增员工 CTA、两栏/堆叠断点、路由地址和独立滚动结构维持原样。
- `data-admin-employees`、`data-employee-row`、`data-employee-avatar`、`data-employee-action`、`data-employee-agent`、`data-employee-agent-source`、`data-employee-binding-preview`、部门筛选及原确认相关属性均未移除。
- 读取中、读取失败、绑定试算失败、绑定失败、撤销失败、停用确认失败和成功回执继续使用现有真实状态/错误展示；没有把失败改写成“未绑定”或成功。
- Agent 名称原有的逐员工“更多/收起”测量与键盘行为保留，未新增权限推导或请求。

## 必须多行的例外

| 位置 | 例外原因 | 保留方式 |
|---|---|---|
| 企业邮箱 | 长邮箱需要完整可读、可复制，不应挤掉状态或操作 | 主行下的 `PropertyList` 详情行，自然换行 |
| Agent 名称 | 可能有多条、草稿/停用标记和超长名称 | 原有独立展开/收起机制保留在元信息槽位 |
| Agent 继承来源 | 同一 Agent 可由多个组织绑定点覆盖，来源不可丢失 | `PropertyList` 的多条“来源”详情行 |
| 覆盖试算新增人员 | 需同时保留组织版本、人数、身份与来源 | 试算属性行 + `RecordRow` 明细 |
| 错误、风险与确认说明 | 业务阻断、确认后果和恢复入口不可为压缩而省略 | 保留在原有 alert/notice/确认卡与弹窗的详情层 |

## 未覆盖范围与边界

- `EmployeeEditDialog` 定义在 `frontend/src/admin/employees/EmployeeDirectory.tsx`；该文件不在本任务允许修改范围内。因此现有短编辑表单、字段名、校验、保存请求和绑定邮箱/KOL 子列表均**未迁移**到 `HorizontalForm`，以避免越界修改业务拥有的组件。
- “绑定新 Agent”的单选与试算区不是 Ant Design `Form`，包含真实覆盖说明与多项候选；未牵强改为 `HorizontalForm`。
- 未审计或迁移其他页面、旧 `EmployeeDirectory.tsx` 的独立入口、共享样式、全局表格或其他路由；不得据此声称全站覆盖。
- 未执行真实用户测试、浏览器视觉回归、触摸交互回归或真实接口/权限集成验证；不得据此声称用户测试或生产验收通过。

## 本地检查证据与限制

- 通过：针对共享原语引用、既有 `data-*` 标记、CSS 作用域及 token 间距的静态断言。
- 通过：使用本机 TypeScript 编译器 API 对修改的 `EmployeeDirectoryV2.tsx` 进行 TSX 语法解析。
- 未通过（环境阻断，非本页结论）：`npm run typecheck` 无法解析 `react` / `react/jsx-runtime`，当前 `frontend/node_modules` 缺失，命令报告跨 242 个文件的 19,553 个环境相关诊断。因此不将该仓库级检查报告为通过。
