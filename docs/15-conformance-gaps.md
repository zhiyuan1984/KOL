# 当前实现与规范符合度

本文件区分“目标规范”和“当前代码”，避免把愿景误当成已实现能力。状态只能由证据更新：代码、迁移、契约测试、真实链路记录或发布单。

## 结论

当前项目是 **KOL 试点原型/过渡实现**，不是已经满足企业多公司、多组织、多品牌和配置化 Agent 愿景的平台。主线 Markdown 现在可以作为目标架构和评审基线，但还不能单独指导生产实现。

## 已有证据

| 规范能力 | 当前证据 | 结论 |
|---|---|---|
| Task/WorkItem/Run/Event/Artifact | `backend/migrations/001_task_runtime.sql` | 有基础运行时模型，但字段仍是单租户/单用户取向 |
| MediaCrawler Job | `backend/migrations/002_mediacrawler.sql`、`backend/src/crawl` | 有异步任务基础 |
| Skill frontmatter/catalog | `backend/skills/*/SKILL.md`、`backend/src/tasks/registry.ts` | 有 Skill 体系，但缺少 Agent manifest、组织/品牌 scope 和统一 Policy manifest |
| KOL 业务资料 | `data/kol/*.md`、`backend/scripts/validate-kol-data.mjs`、`agents/kol/manifest.yaml` | 已建立 canonical Markdown 入口、试点 manifest 和安培时代试点组织/PEP registry；尚未接入全平台 Agent registry |
| 契约编译器 | `config/*.yaml`、`agents/kol/manifest.yaml`、`experts/kol/manifest.yaml`、`workflows/*.yaml`、`policies/*.yaml`、`schemas/*.json`、`evals/kol/core.jsonl`、`backend/scripts/validate-contracts.mjs` | 试点契约可解析；安培时代组织绑定已确认；仍未完成全平台 Agent registry |
| DigitalEmployee / Expert | `experts/kol/manifest.yaml`、`GET/POST /api/experts` | 首版名册 + 召唤绑定会话；知识范围 / LIVE 健康 / 运行投影仍缺，见 manifest `missing_fields` |
| Codex app-server 路径 | `backend/src/worker/runner.ts` | 生产默认走 Codex，但仍保留 `runStub` 和 `compose_preview_only` 分支，需要环境门禁和验收隔离 |
| 员工端/管理端 | `frontend/src/pages`、`backend/src/routers/enterprise.ts` | 页面和权限雏形存在；安培时代公司、组织树和部门负责人已确认，成员级身份/授权的长期同步仍待接入 |
| L1/L2/L3、邮件和阶段 | `backend/src/host`、`backend/tests` | 部分规则有测试，但硬编码仍分散在 Host、前端和任务解析器 |

## 关键缺口

1. **组织实现缺口**：安培时代组织主数据已经确认并进入 registry，部门负责人按公司政策自动拥有全部品牌、区域和普通数据读写范围；数据库仍缺少正式的 `company`、`organization_unit`、`membership`、`brand_scope`、`responsibility_assignment` 关系表，长期同步和审计版本仍需补齐。
2. **Agent 配置缺口**：KOL 试点已有 `agents/kol/manifest.yaml` 和契约编译器，但前端 `agentConfig.ts`、后端 `skills-catalog.ts`、任务 registry 仍各自维护能力和入口，尚未由统一 manifest 生成。
3. **Host 硬编码缺口**：`backend/src/host/api.ts`、`sops.ts`、`tasks/resolver.ts`、`frontend/src/journey.ts` 和推荐配置仍包含业务目录、推荐、模板或意图分支，与迁移路线不一致。
4. **知识库缺口**：`data/kol` 已成为 KOL 业务资料原件并有结构校验，但尚未统一补齐租户、组织、品牌、区域、有效期、来源和敏感级别元数据契约。
5. **前后端契约缺口**：Task/WorkItem 状态、事件、Artifact、ApprovalRequest 的版本化 schema 尚未成为共享契约；前端仍有业务判断和本地映射。
6. **测试评价缺口**：已有大量测试，但没有以 `FS-*`、`BR-*`、`EVAL-*` 组成完整追踪矩阵，真实 app-server/MCP 评价和 Stub 测试边界还需单独门禁。

## 结论性使用规则

- 当前可以用主线 Markdown 做需求评审、架构决策、代码评审和迁移计划。
- 当前不能仅凭 Markdown 创建生产 Agent；必须先补齐 `14-implementation-contract.md` 要求的机器可读资产和共享 schema。
- 安培时代组织主数据和试点 PEP 已可作为授权依据；在统一多公司 registry、全量测试和生产运行链完成前，KOL 仍不能宣称已经达到通用企业中台。

## 下一阶段完成条件

先完成真实公司/品牌绑定和权限上下文，再统一 Agent manifest、Skill/Workflow/Policy schema；随后把前端/Host 重复目录迁入声明式资产，补齐功能规格追踪和真实链路评价。当前契约编译器已经能阻止未注册引用和缺失证据，但仍只覆盖 KOL 试点。
