# 独立规范集

版本：候选版 1.0 · 2026-09-21

本目录是一套可单独阅读、评审和迁移的规范候选。正文由仓库有效材料复制、收敛而来，并参考历史材料核对遗漏；它不引用外部的同名现行文档，也不引用历史归档目录。

在获得用户批准并完成迁移前，本目录**不是现行法，也不改变运行代码**。现行仓库仍按根目录 `AGENTS.md` 指定的入口执行。

## 文档层级

1. [CONSTITUTION.md](CONSTITUTION.md)：十条宪法和修订程序。
2. [PRODUCT.md](PRODUCT.md)、[BUSINESS.md](BUSINESS.md)、[TECHNOLOGY.md](TECHNOLOGY.md)：三部基本法。
3. 其余文件：实施细则，只能落实上位规则，不能覆盖四份上位文件。

## 实施细则

| 文件 | 范围 | 所属基本法 | 责任角色 |
|---|---|---|---|
| [DESIGN.md](DESIGN.md) | 视觉 token、密度、设备适配和 UI 验收 | PRODUCT / TECHNOLOGY | UI/UX 专家、前端专家 |
| [ia-information-architecture.md](ia-information-architecture.md) | 页面职责、导航与使用/治理分离 | PRODUCT | 平台产品经理、UI/UX 专家 |
| [org-permissions.md](org-permissions.md) | 组织、范围、权限、审批和审计 | BUSINESS / TECHNOLOGY | KOL 业务专家、后端专家 |
| [domain-objects.md](domain-objects.md) | 领域对象、关系和字典 | PRODUCT / BUSINESS | 平台产品经理、KOL 业务专家 |
| [business-rules/stage-transitions.md](business-rules/stage-transitions.md) | 合作阶段和合法转移 | BUSINESS | KOL 业务专家 |
| [07-mcp-data-contract.md](07-mcp-data-contract.md) | 工具风险、物理接口和真实调用 | TECHNOLOGY | 架构师、后端专家 |
| [18-mcp-master-data-assessment.md](18-mcp-master-data-assessment.md) | 有日期的事实源评估 | BUSINESS | KOL 业务专家 |
| [VERIFICATION.md](VERIFICATION.md) | 与历史规范的对比证据、限制和生效门禁 | 全域 | 项目经理、测试经理 |

## 使用规则

- 先按 CONST-08 审宪，再加载与任务相关的基本法和实施细则。
- 本目录内部链接可以作为规范引用；指向代码、配置和接口的链接只作为实施证据，不因此获得法律位阶。
- 评估报告中的事实结论必须带日期和证据状态；证据缺失时不得使用“100%真实”或“已正式确认”等无范围结论。
- 历史决定只解释原因。当前规则以本目录正文为准，不要求读者访问历史归档。
