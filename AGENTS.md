# 本仓库规范入口

> 任何任务开工前先读本文件。本文件只写「先读什么、禁止什么」，不重复法条正文。

## 1. 加载顺序

```text
本文件（AGENTS.md）
→ docs/CONSTITUTION.md          宪法：十条宪法 + CONST-08 审宪程序
→ 按领域加载三部基本法（只加载相关的，不要全读）
→ 涉及界面与交互：读 docs/DESIGN.md（实施细则；唯一 token 数值来源；风格基准 data-dense-dashboard）
```

| 领域 | 读哪一份 |
|---|---|
| 平台能力、Agent 交互、记忆 | `docs/PRODUCT.md`（PROD-PLAT-01~07、PROD-AGENT-01~09） |
| KOL 对象、SOP、阶段、审批、权限 | `docs/BUSINESS.md`（BIZ-01~18）+ `docs/org-permissions.md` |
| 组件与调用、前后端实现、测试发布 | `docs/TECHNOLOGY.md`（TECH-ARCH/FE/BE/TEST） |
| 对象与字典值 | `docs/domain-objects.md` |
| 合法阶段转移 | `docs/business-rules/stage-transitions.md` + `config/stage-transitions.json` |
| 工具风险与物理闸门 | `docs/TECHNOLOGY.md` 的工具风险目录 / `docs/07-mcp-data-contract.md` |
| 导航与一页一问 | `docs/ia-information-architecture.md` |
| 决策历史 | `docs/DECISIONS.md`（只追溯「为什么」，不是现行法） |
| 视觉 token 与设备适配 | `docs/DESIGN.md`（实施细则；唯一 token 数值来源；风格基准 `data-dense-dashboard`） |

旧规范全文在 `nothings/`，**不是现行法**，只在核对迁移或历史时读。已废止的 UI/UX 设计法 11 份在 `nothings/law-ui-ux/`。

## 2. 审宪程序（CONST-08，任何变更都要做）

先审宪、再审法。审查记录至少包含：

```text
需求 → 主责角色 → 宪法条款 → 基本法条款 → 结论与证据 → 下一步
```

四档结论，不许含糊：

| 结论 | 处理 |
|---|---|
| 符合 | 在已授权范围继续实施 |
| 违宪 | 指明条款与冲突行为，调整方案 |
| 违反基本法 | 引用文件、编号、原文与证据；由该领域角色修正方案 |
| 规则空白或冲突 | 交所属角色补充；只暂停依赖该决定的部分 |

**没有条款依据，不得用「可能违宪」阻止工作。** 发现已有代码不合规，记录具体差距，不把现状写成法律。

## 3. 禁止

- 在页面重写业务权限、审批、阶段判定（CONST-04；前端只实现已定义规则）。
- 用文档、占位页面、模拟结果或测试通过冒充完整生产能力（CONST-10）。
- 为了让代码通过而偷偷改法（CONST-09）。
- **凭文件名或目录名猜法律层级。** 先把仓库里的文件列全再判断——例如 `docs/` 下有过 `law-v2/`、`median_mcp_server.md`（内容其实是 MediaCrawler）这类名字与内容不符的情况。
- 在法条正文里写 hex 或 token 数值；数值只住 `docs/DESIGN.md`，落地实现是 `frontend/src/styles.css`（两者不一致时先核对 DESIGN.md）。
- **若任务涉及「把工具/技能/数据渲染成界面元素」，必须同时读工具风险目录**，核对 L1/L2/L3 分档与异步契约（例如：MediaCrawler 是异步作业，不得伪装成同步 Skill）。

## 4. 关键不变量（跨领域，违反即停止）

- **发送 ≠ 推进阶段**：`发送`/`暂存`/`导入`/`解密`/`删除`是不同副作用，必须独立动作与状态。
- **L1/L2/L3 分档可见**：L1 只读直接执行；L2 草稿必须标注；L3 外发/导入/删除/解密执行前必须确认并留有回执。
- **同一视口 0–1 个实底主 CTA**（`DESIGN.md` §5 规则 1）；其余动作降低强调。
- **真实等待有原因、阶段与恢复入口**；不得伪造完成、联系人、结果或进度。
- **状态不能只靠颜色表达**（WCAG 2.2 AA；`DESIGN.md` §5 规则 4）。
- **设备适配按三轴管**（宽度 × 高度 × 输入模态），禁止 UA 嗅探，禁止把三轴合成设备名（`DESIGN.md` §6.1）。
- **同一时间只跑一个 MediaCrawler 采集任务**；采集是异步作业，必须有进度、取消、重试。

## 5. 目录地图

```text
AGENTS.md                      本文件（唯一自动加载的规范入口）
README.md                      项目说明
docs/
  CONSTITUTION.md              宪法（十条 + 审宪程序）
  PRODUCT.md  BUSINESS.md  TECHNOLOGY.md   三部基本法
  DESIGN.md                    视觉 token 与设备适配（**实施细则**，非基本法）
  DECISIONS.md                 ADR 变更日志（只追溯「为什么」，不是现行法）
  org-permissions.md           组织、范围、PEP、确认/审批/审计
  domain-objects.md            对象、关系、字典值
  ia-information-architecture.md  导航、一页一问、使用≠治理
  07-mcp-data-contract.md      工具风险目录、真实调用规则、物理闸门
  18-mcp-master-data-assessment.md  事实源评估
  business-rules/stage-transitions.md   合法阶段转移（15 + exception）
  superpowers/                 实施计划与设计稿
  codex/                       app-server 协议 schema
nothings/                      已废止的旧规范全文（只供迁移核对）
  law-ui-ux/                   已废止的 UI/UX 设计法 11 份（原 design.md、MASTER.md、单页规范、openai-style 等）
specs/  policies/  workflows/  config/  schemas/   规格、策略、流程、配置、契约
```

## 6. 验证

- 后端：`backend/package.json` 的契约校验、类型检查、测试、评价与发布门禁。
- 前端：`frontend/package.json` 的构建、类型检查与 E2E。
- 发布门禁：`.github/workflows/release-gate.yml`。
- 只读或记忆类功能不需要为了证明可用而发信；验证外部写入必须用明确授权的对象与范围。
