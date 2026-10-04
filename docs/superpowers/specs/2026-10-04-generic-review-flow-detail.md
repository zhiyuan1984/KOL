# 通用评审流程详细设计

版本：v0.1 · 日期：2026-10-04 · 状态：设计交付，应用代码尚未实施。

上接[概要设计](2026-10-04-generic-review-flow-overview.md)与[现状评审](2026-10-04-approval-v2-review.md)。下接[实施与验收计划](../plans/2026-10-04-generic-review-flow-implementation.md)。本文件为实施设计，不改变宪法、业务制度或生产授权。

## 1. 设计输入、范围与审查

用户要求：员工能够发起评审；管理员能够新建、拖拽配置并发布评审流程；费用、内容、合同等共用框架。本轮将概要设计落成可拆分开发的模块、数据、接口、算法和交互契约。

现状基线：工作区已有 approval 模块、员工/管理页面、chain/current_index 执行、approval_types 单行版本；附件另含多类型发起、超时与 FlowDesigner 增量。两者按现状评审的清单逐文件迁移，不整包覆盖。已确认 `db.ts` 按 DATABASE_URL 选 PostgreSQL，否则 SQLite；存在 execution_jobs、execution_outbox、cron/worker.ts、cron/store.ts、cron/authz.ts。新增评审状态不自建第二套消息中间件。

设计目标包括可配置表单、节点级运行、不可变发布版本、权限与正式命令、持久超时、通知、设计器与旧单兼容。首版不包含任意图循环、并行分支汇合、脚本节点、子流程、完整 BPMN、系统默认自动批准和任意 URL 调用。

### 1.1 CONST-08 记录

| 需求 → 主责 | 宪法 → 基本法 | 结论、依据与下一步 |
|---|---|---|
| 通用流程与表单 → 平台产品经理、架构师 | CONST-02/04；PROD-PLAT-03/05；TECH-ARCH-03/04 | **符合**：平台提供解释器，业务规则引用发布配置；实施共享版本契约 |
| 员工发起与人工决定 → 业务专家、后端 | CONST-03/05/06；BIZ-02/03/14/15；TECH-BE-01/02/03 | **符合**：稳定身份、当前资格、确认摘要、原子命令和回执；禁止模型代批 |
| 可视化编辑 → UI/UX、前端 | CONST-04/07；TECH-FE-01/03；DESIGN §1/6/11/13 | **符合**：单一文档状态，预览/发布绑定版本，前端不授予权限 |
| 到期处理与受控动作 → 后端、测试经理 | CONST-05/10；PROD-PLAT-06；TECH-BE-04/08；TECH-TEST-02/03 | **符合**：复用持久作业与 outbox，租约、节点版本、授权和未知回执均有处理 |
| 多人否决、自批、代理、重审、时限 → 业务专家 | CONST-04/08/09；BIZ-14/15 | **规则空白或冲突**：以必须显式选择且带制度依据的配置承载，缺规则只阻断相应模板发布 |

关键原文：TECH-BE-02“审批链有引用、人员存在并不足以证明有审批权”；TECH-FE-03“版本变化后提示差异，不能拿旧确认提交新内容”；BIZ-15“实质内容、金额或授权条件改变后，旧审批不能自动覆盖新版本”。本设计解决已有违规路径，不把现状写成新规则。

## 2. 模块分工与文件落点

以下为拟新增或拆分路径，并非现有资产声明。

| 模块 | 拟落点 | 职责 |
|---|---|---|
| 定义与契约 | `schemas/review/`、`backend/src/approval/contracts/` | 版本化 JSON Schema、运行时校验与生成 TS 类型；前端不得复制另一份语义 |
| 定义校验 | `approval/definition-validator.ts` | 图、字段、表达式、能力依赖、业务规则引用校验 |
| 表单规范化 | `approval/form.ts` | 类型转换、必填、字段权限、附件与对象引用校验 |
| 条件解释 | `approval/expressions.ts` | 有类型 AST 的纯求值，不使用 eval 或任意脚本 |
| 身份/范围 | `approval/access.ts`、`approval/assignees.ts` | 当前身份、对象范围、角色候选、授权解释 |
| 模板版本 | `approval/definitions.ts` | 草稿 CAS、验证报告、发布与停用 |
| 预览确认 | `approval/prepare.ts` | 内容和依据摘要、确认记录、过期与失效 |
| 命令协调 | `approval/commands.ts` | 版本、幂等、事务、动作审计与回执 |
| 节点执行 | `approval/engine.ts` | 节点激活、参与任务、聚合决定、迁移 |
| 数据仓储 | `approval/repository.ts` | 强制 tenant_ref 查询、事务连接、索引和分页 |
| 超时/后续动作 | `approval/timers.ts`、`approval/execution.ts` | 复用 execution_jobs/outbox 和现有 cron，处理重试与接管 |
| 投影/通知 | `approval/projection.ts`、`approval/notifications.ts` | 授权后的队列、详情、通知投递，不反推业务事实 |
| 兼容层 | `approval/legacy.ts` | legacy ID 路由、旧单据读取和受控命令适配 |
| 员工 UI | `frontend/src/approvals/` | Catalog、DraftForm、PrepareSummary、Inbox、InstanceDetail、ActionDialog |
| 管理 UI | `frontend/src/admin/approvals/` | TemplateList、VersionEditor、FormBuilder、ValidationPanel、PublishDialog |
| 流程图 UI | 现有附件 `components/FlowDesigner/` 演进 | 受控画布、列表、属性编辑、历史命令与布局 |

旧 routers/approvals.ts、approval-types.ts 保留路由挂载，业务逻辑移到服务层。网关 wecom.ts 拆出通道职责，不再同时拥有“审批引擎”和“企微通知”两个真相源。

## 3. 定义文档契约

### 3.1 ReviewDefinition（schema_version = review.definition.v1）

| 字段 | 类型/约束 | 含义 |
|---|---|---|
| schema_version | 固定字符串 | 协议版本；未知主版本拒绝 |
| template_id / business_kind | 稳定 ID / 已登记业务码 | 类型身份；不默认 expense |
| title / description / owner_ref | 文本 / 稳定责任引用 | 展示和治理责任 |
| policy_refs | `[{id,version,content_hash}]` | 业务制度/动作策略依赖，不从自由文本生成权限 |
| initiate_scope / govern_scope | ScopeSelector | 发起与治理范围；不替代业务数据范围 |
| visibility_policy_ref | 版本化策略引用 | 不同职责可读字段及历史可见性 |
| form | FormDefinition | 字段、顺序、规则、绑定 |
| flow | `{start,nodes}` | 节点 map；节点 ID 必须与 map key 一致 |
| presentation | `{layout,collapsed_groups}` | 画布位置等展示元数据；不能影响业务条件 |
| result_contract | `{mode,action_refs}` | `decision_only` 或 `controlled_actions` |
| amendment_policy_ref | 可选发布策略 | 修改范围、重审起点、可沿用决定的条件 |

ScopeSelector 使用同租户有效组织/人员/职责引用和明确 descendants 选项，不使用“dept”自由字符串。全公司范围也必须显式配置 company_ref，不以空值代表全量。模板发起范围只约束业务动作入口，不建立新的 Agent/技能人员授权体系。

草稿允许暂时不完整；保存只验证 JSON 类型、安全边界和 ID 结构，返回 issues。发布必须通过完整校验。发布版本冻结完整 document；单独记录 document_hash 和 runtime_hash：前者含布局与文案，后者含全部执行语义、参与人、权限、字段与规则。发布证据绑定 document_hash，申请确认绑定发布版及规范化材料。

### 3.2 字段定义及值类型

字段统一有 key、label、type、required、visible_when、required_when、validation、read_policy_ref；key 只允许小写字母/数字/下划线且不能是原型链保留名称，跨版本保留含义，禁止同 key 改为无兼容关系的类型。

| 字段类型 | 提交值 | 服务端校验 |
|---|---|---|
| text / textarea | string | 发布配置的长度、格式；格式限已登记验证器 |
| decimal | 十进制字符串 | 精度、小数位、上下限；不使用浮点比较金额 |
| money | `{amount:"123.45",currency:"CNY"}` | 币种字典、精度、业务来源；不自动换币 |
| date / date_range | `YYYY-MM-DD` / `{from,to}` | 日期合法性、区间顺序；日历日期不转 UTC 瞬间 |
| select / multiselect | option_id / option_id[] | 值在当前版本选项集合中；多选去重，按定义顺序规范化 |
| person / people | principal_ref / refs[] | 当前可选择范围与稳定身份映射 |
| attachment | `[{artifact_id,version,content_hash}]` | 所有权/分享权、类型/大小策略、上传完成状态 |
| business_object | `{object_type,object_id,version}` | 已登记对象类型，当前读取权与权威版本 |

未声明字段拒绝，错误归到 `/form/fields/<key>`。未显示字段默认不进入有效提交内容；若模板要求保留隐藏值，必须显式配置 retain_when_hidden，并仍按字段权限及约束验证。隐藏但无默认可信来源的无条件必填属于定义错误。

金额计算使用十进制/整数缩放实现；精度与舍入方式来自业务发布策略，禁止浮点近似后用于审批分档。所有派生数值记录输入引用、算法版本和来源。表单 required_when 引用图不得循环；先规范化基础字段，再取授权事实/计算字段，再执行条件必填，最后计算路径。

### 3.3 条件 AST

UI 提供“字段—运算符—值”的构造器；高级模式只展示受控表达式，不接受 JavaScript。

```json
{
  "op": "and",
  "args": [
    {"op": "eq", "left": {"ref": "form.content_kind"}, "right": {"literal": "video"}},
    {"op": "gte", "left": {"ref": "business.risk_score"}, "right": {"decimal": "60"}}
  ]
}
```

支持 and/or/not、eq/ne、gt/gte/lt/lte、in、exists；比较双方类型必须相容。数据分 form、system、business 三命名空间，system/business 只可读。保留字段不能通过 spread 覆盖。缺失值为 unknown，不视为 false/0；仅 exists 可以判断缺失。unknown 会阻断节点并指出数据来源问题，不能直接走默认分支。

业务分支采用显式 `match_policy: first_match` 并保留数组顺序；默认分支只有在全部条件明确 false 时匹配。管理员看到匹配优先级和重叠提醒。首版不承诺自动证明任意条件互斥；校验器可检测重复条件，边界样例由规则负责人提供。

资源限制：节点上限 100、每分支上限 20 条、表达式深度 10、AST 节点数 200、字段上限 100、定义 JSON 最大 1 MiB。以上是首版技术保护配置，不是业务限额；超过限制明确错误，不截断后成功。

### 3.4 节点联合类型

所有节点包含 id、type、title；字段按 type 严格验证，禁止混用无效配置。

| type | 必填执行字段 | 语义 |
|---|---|---|
| start | next | 唯一开始，无入边 |
| review | assignees、mode、reject_policy、next、actions、policy_ref | 有决定权的人工评审 |
| condition | branches[{id,when,next}]、default_next、match_policy | 单路径路由 |
| cc | recipients、field_policy_ref、next、delivery_policy_ref | 创建通知与只读授权记录，投递不授予审批权 |
| consult | participants、completion_policy_ref、next | 征询意见，可等待已定义完成条件；无批准动作 |
| handler | assignees、completion_schema、completion_policy_ref、next | 提交办理结果和证据，不改变既有评审决定 |
| execution | action_ref、input_bindings、authorization_policy_ref、next | 已登记受控动作，不支持任意脚本/URL |
| end | result = approved | 正常通过终点；拒绝/撤回为显式命令终态 |

review.mode：single/all/any/sequential。前端中文分别单人/会签/或签/依次处理。reject_policy 必填；首版支持 any_reject 与 all_reject（后者只适用于 any 模式），策略选择必须具有业务依据。余下任务在节点终结时设为 closed，reason 区分 satisfied、rejected、withdrawn、superseded，而非伪造“已同意”。

参与人规则允许 named、role、manager_chain、previous_node、requester_selected；包含明确 resolve_at 与 policy_ref。single 必须恰好一名有效人员；all/any 至少一名；sequential 具有稳定顺序。解析结果过多不任取第一人。多规则汇总去重只在节点内进行，并保存每人的来源，跨节点同人是否允许由策略决定。

角色候选来自权威 registry 与已确认人员绑定。连接器同步目录只能作为已指定来源的事实输入，不能自动成为审批授权；不能直接把 runtime_connector_organization_nodes 或姓名匹配当成角色资格。

默认自批处理采用阻断而不是自动跳过；业务已发布自批/代理例外时由显式策略允许并记录依据。缺审批人、未知角色、循环组织链一律出具错误，不调用 emp_wang、首个用户或 CEO 默认值。

### 3.5 定义校验与发布准入

分五层：schema → 图结构 → 字段/表达式 → 授权与业务依赖 → 发布验证。

- 一个 start，至少一个 end；全部可执行节点从 start 可达；每条可能路径最终到 end；不允许环、悬空引用、重复节点/分支 ID。
- previous_node 只能引用在该节点每条入口路径上均已执行的节点；不能引用自己或尚未发生的节点。
- 验证字段类型、条件依赖、隐藏必填、附件能力、角色引用、参与人数及 mode/reject_policy 组合。
- 为避免批准/业务执行互相混淆，首版 execution 只能位于全部人工评审结束后的尾段，且之后不得再出现 review 或修改申请材料的节点。每条批准路径进入执行前冻结决定结果；需要中途执行并继续评审的复杂业务暂不支持发布。
- 具有 controlled_actions 的定义必须至少绑定一个有效 action；decision_only 不得含 execution。每条可通过路径至少经过一个有决定权的 review，不能以空图或只含 end 构成自动批准。
- 验证已实现 capability 清单，前端与服务端一致。consult/handler/execution 未实现时不得发布，不能只渲染标签。
- 每条可达分支含明确命中样例，金额/日期边界包含临界前后值；样例不是现实事实。验证报告记录内容 hash、规则/组织版本、覆盖与阻断问题。

## 4. 存储设计

### 4.1 通用约束

新增表使用 review_ 前缀，不覆盖 legacy 表。ID 使用现有 nid 工具产生的带前缀稳定值；API 对版本号使用安全整数；审计序号可用十进制字符串。时刻统一 UTC ISO；业务日历保留日期、IANA 时区及日历版本。设计约定 JSON 字段由 repository 编解码，跨 PostgreSQL/SQLite 不依赖方言 JSON 查询。

所有领域表包含 tenant_ref、id、created_at；可变对象增加 version、updated_at。跨表引用要求同 tenant，目标表有 UNIQUE(tenant_ref,id)，子表使用复合外键，防止仅凭全局 ID 跨租户连接。正式实例、决定、回执禁止级联删除；保留/脱敏依现行保留策略执行。

### 4.2 表与约束

| 表 | 主要列（通用列除外） | 唯一约束 / 索引 |
|---|---|---|
| review_templates | code、name、business_kind、owner_ref、status(enabled/disabled)、active_version_id | UQ(tenant,code)；idx(tenant,status,name,id) |
| review_definition_drafts | template_id、base_version_id、revision、document_json、document_hash、edited_by | UQ(tenant,template_id)，首版每模板一个共享工作草稿；CAS 防覆盖 |
| review_definition_versions | template_id、version_no、schema_version、document_json、document_hash、runtime_hash、policy_refs_json、published_by、published_at | UQ(tenant,template_id,version_no)；发布内容不可 UPDATE |
| review_validation_reports | draft_id、draft_revision、document_hash、dependency_hash、result_json、status | idx(tenant,draft_id,draft_revision) |
| review_application_drafts | template_version_id、requester_ref、submitted_by_ref、scope_json、form_json、revision | idx(tenant,requester_ref,updated_at,id) |
| review_preparations | actor_ref、action、resource_ref、source_revision、payload_hash、evidence_hash、summary_json、normalized_input_json、expires_at、consumed_command_id | idx(tenant,actor_ref,expires_at)；指向命令，单次使用 |
| review_instances | template_version_id、business_kind、requester_ref、submitted_by_ref、decision_status、run_status、current_round、current_revision_id、scope_json、object_ref_json、latest_event_seq | idx(tenant,requester_ref,created_at,id)、idx(tenant,run_status,updated_at,id) |
| review_revisions | instance_id、revision_no、form_json、artifact_refs_json、material_hash、source_versions_json、submitted_by_ref | UQ(tenant,instance_id,revision_no)；提交后不可变 |
| review_node_instances | instance_id、round_no、node_key、node_type、status、material_revision_id、assignment_revision、resolution_snapshot_json、activated_at、completed_at | UQ(tenant,instance_id,round_no,node_key)；idx(tenant,status,instance_id) |
| review_participant_tasks | instance_id、node_instance_id、principal_ref、duty、sequence、assignment_revision、status、decision、close_reason、completed_at | UQ(tenant,node_instance_id,assignment_revision,principal_ref,duty)；idx(tenant,principal_ref,status,created_at,id) |
| review_decisions | task_id、node_instance_id、instance_id、command_id、actor_ref、outcome、reason、material_hash、authorization_evidence_json | UQ(tenant,task_id)，一个任务只有一项有效最终决定；补充意见用事件 |
| review_access_grants | instance_id、principal_ref、grant_type、field_policy_ref、source_ref、revoked_at | UQ(tenant,instance_id,principal_ref,grant_type,source_ref)；idx(tenant,principal_ref,revoked_at) |
| review_commands | actor_ref、action、resource_ref、idempotency_key、payload_hash、status、result_ref_json | UQ(tenant,actor_ref,action,resource_ref,idempotency_key) |
| review_events | instance_id、sequence、event_type、command_id、actor_ref、before_version、after_version、payload_json | UQ(tenant,instance_id,sequence)；idx(tenant,command_id) |
| review_timers | instance_id、node_instance_id、assignment_revision、kind、due_at、policy_ref、status、execution_job_id、fence | UQ(tenant,node_instance_id,assignment_revision,kind,due_at)；idx(status,due_at,id) |
| review_action_runs | instance_id、node_instance_id、action_ref、input_hash、authorization_ref、execution_job_id、status、receipt_ref、attempt | UQ(tenant,node_instance_id,action_ref,input_hash) |
| review_notification_deliveries | instance_id、event_id、recipient_ref、channel、status、execution_job_id、receipt_ref | UQ(tenant,event_id,recipient_ref,channel) |
| review_legacy_refs | legacy_system、legacy_id、engine_version、mapped_instance_id、migration_state | UQ(tenant,legacy_system,legacy_id) |

review_instances 决定状态：pending/approved/rejected/withdrawn；运行状态：reviewing/awaiting_amendment/blocked/awaiting_execution_confirmation/executing/completed/execution_failed/execution_uncertain。申请草稿在独立表，不伪装成已提交实例。实例从创建起有 version；节点/任务各自也有 version。

所有外部候选/摘要只存必要字段和来源，角色快照供审计不直接授予当前权限。access_grants 只是索引入口，读取仍与当前成员资格、职责及对象范围交集校验；历史参与权是否保留由版本化可见性策略决定。

### 4.3 物理迁移

为当前两种 DB 编写独立、等价 DDL（具体递增编号在实施时按仓库迁移序列分配）。SQLite 使用 TEXT JSON/时间、显式 CHECK 与外键；PostgreSQL 保持 repository 一致的列契约。运行 initSchema 与 PostgreSQL schema apply 两条路径均覆盖新表，不能只新增 SQLite 自初始化。

不依赖 INSERT OR REPLACE 来维护版本记录。正式迁移先建表和索引，再校验后启用；发布版本和决定表由 repository 限制修改入口。迁移以 schema version 记录幂等，测试空库、已有 legacy 数据库和重复执行。

## 5. 服务与运行算法

### 5.1 prepare 与 commit

prepare 是无业务副作用的预览，可持久保存确认依据；不创建正式实例、节点通知或外部动作。

1. 从会话/已授权调用上下文取得 actor/tenant；默认 requester=actor。代申请必须带有效 delegation_ref，验证受托范围。
2. 校验模板当前启用、版本有效、发起范围、治理/执行策略未撤销；根据已授权对象确定业务 scope，不能接受客户端声称的全公司范围。
3. 验证草稿 revision、附件、对象版本和 form schema；解析当前权威组织/业务事实，缺来源返回明确缺口。
4. 同一纯解释器执行路径预览。已确定节点显示实际参与人；依赖前序实际处理人的节点显示规则和“届时解析”，不伪造最终人员名单。依赖未来节点输出的分支首版不支持发布，允许的 previous_node 只影响角色解析。
5. 写入 preparation，绑定 action、actor、tenant、草稿 revision、模板版本、材料 hash、scope、组织/规则/对象来源版本、结果摘要。有效期由平台技术配置管理，初始建议 10 分钟；过期要求重新预览，不改变业务时限。
6. 返回服务器生成的可展示摘要与 confirmation_id。摘要只包含调用人可见信息，不泄漏隐藏审批理由或他人私有字段。

commit 按以下顺序处理：当前身份与最低资源访问权 → 命令幂等查重 → 验证 preparation → 复核当前权限/依据 → 事务落地。

命令重放要先于“确认已消费/旧版本”判断，否则成功后的网络重试会误报失败。相同 key 但 payload_hash 不同返回 IDEMPOTENCY_CONFLICT；已撤权调用不能通过重放取回敏感结果，只返回通用拒绝。持久 result_ref 保存结果标识与不敏感状态，返回时再授权投影，不能缓存全量 JSON 绕过撤权。

事务内原子插入 command，CAS 消费 preparation，创建 instance/revision/初始节点、任务、事件、timer/job/outbox，记录 command.result_ref。任一步失败全部回滚。无异步外部 IO 放进同步 tx 回调。

组织/权限存在本地 authority epoch 时事务内复核一致；外部事实的版本通过权威适配器校验。变化则返回 PREVIEW_STALE 并给差异，不自动扩大确认范围。依赖事实无法重新验证时阻断，不凭旧缓存猜测当前授权。

### 5.2 激活节点

引擎在同一实例上串行推进；一个时刻最多一个活动业务节点，节点内允许多个参与任务。沿 start/condition/cc 等确定节点推进到第一个等待点或 end。每次推进有持久事件；技术步数达到上限时报定义故障并 blocked，绝不作为成功退出。

review 激活时按当前组织解析规则，冻结本轮 participants 与材料 revision，创建任务和对应 timer。后续仍检查每个人的当前资格；人员离职不自动降低会签分母。资格变化进入 blocked 或执行已发布的重派策略。

sequential 只将第一位任务设 pending，其他为 queued；其他模式同时 pending。节点内候选解析必须返回 eligibility evidence；前端只能选择返回的合法候选，后端提交时再次验证。

cc 创建可见性授权和通知作业后继续；投递失败不会伪造成功，是否阻断整段由必填 delivery_policy_ref 规定。consult 和 handler 使用独立职责与完成事件，不能调用 approve API。

### 5.3 决定与多人聚合

有效决定条件：当前身份匹配任务、同租户、任务 pending、当前资格成立、instance/node/material/assignment revision 都匹配、有效 confirmation、命令幂等键。拒绝理由遵守 BIZ-15；条件改变必须重新确认。

| 模式 | approve 处理 | reject 处理 |
|---|---|---|
| single | 唯一任务通过则节点通过 | 节点拒绝 |
| all | 全部有效任务通过才通过 | any_reject 策略下任一拒绝终止 |
| any + any_reject | 首个成功提交的 approve 终结节点 | 首个成功提交的 reject 终结节点 |
| any + all_reject | 任一 approve 终结节点 | 全部拒绝才拒绝，否则等待剩余任务 |
| sequential | 通过后激活下一人，末位通过才通过 | any_reject 策略下当前拒绝终止 |

这里定义引擎可支持语义，不替企业选择策略。业务若不能接受“或签+任一否决”的先提交决定结果，应选择其他模式/策略或提出新规则，不能依靠前端显示顺序决定。

并发：同实例事务 CAS 决定顺序。两人同时在 any 节点操作，一方提交后另一方以过期任务返回 NODE_ALREADY_RESOLVED，不写第二个有效决定。all 节点不同人员同时提交，竞争方重新读取聚合状态；若自身任务、材料、资格未变，服务端允许有限事务重试。外部 API 不暴露数据库并发异常。

### 5.4 转交、加签、撤回、补充材料

| 动作 | 前置条件 | 原子变化 |
|---|---|---|
| 转交 | 模板允许、操作者是当前任务责任人、有资格目标、匹配版本 | 当前任务设 transferred；新建目标任务；assignment_revision+1；保存原决定/责任历史；重建未来 timer 并记录通知 |
| 加签 | 模板允许、目标有权、策略明确插入方式 | all 模式扩充未完成成员；sequential 模式按配置插入；single/any 首版拒绝该动作，不静默改变 mode |
| 撤回 | 当前发起人或有效代理、模板允许、尚无不可逆外部提交 | 终结实例为 withdrawn，关闭未完成任务，取消尚未执行计时/作业；保留历史 |
| 请求补充 | 当前评审任务有权、定义允许、给出所需材料与原因 | run_status=awaiting_amendment，相关任务 suspended，timer 按发布策略暂停/重排 |
| 重新提交 | 发起人补充获准字段、再次 prepare/confirm、重审策略可执行 | 新建不可变 revision、round+1，supersede 旧未决任务；按策略重启指定节点，保留旧决定覆盖版本 |

assignment_revision 变化时未处理任务的候选集、计时与资格一起更新；已完成任务与 decision 不改写。是否重置已过去时限必须由策略明确，不默认给新审批人额外 48 小时。

首版材料修改仅支持明确的“从开始全部重审”策略；更细的“仅重审受影响节点”作为后续能力，未实现时拒绝发布相应策略。引用同一人前序决定不意味着新材料自动沿用旧批准。执行已开始或结果未知后不得撤回冒充回滚，应走接管/补偿业务流程。

### 5.5 评审通过与受控执行

decision_only 在正常 end 上将 decision_status=approved、run_status=completed。存在执行尾段时，在进入第一个 execution 前记录 approved，再按动作授权契约等待确认或开始执行。

动作输入绑定材料 revision、对象版本、已发布 action/skill/Agent 依赖及确认依据。审批同意不自动等于发信/导入等执行确认；若同一确认需覆盖二者，摘要必须明确展示并且已发布政策明确允许，否则进入 awaiting_execution_confirmation。管理员身份也不能绕过。

复用 execution_jobs，stable effect key 包含 tenant/instance/node/input_hash/action_version。worker 提交前再次校验人员或服务身份、业务范围、有效授权和当前对象版本。执行 MCP/API/知识库遵守既有技能与 Gateway 路径，不直接从新引擎发 HTTP。

作业成功只根据真实回执；超时且可能已提交设 uncertain，先查询外部状态或人工核对。不同动作（例如发信与改阶段）各自生成 action_run、授权和回执，不合成隐式复合副作用。

### 5.6 状态迁移表与不变量

实例状态分两个正交字段。无外部动作的办理/征询仍属于评审过程；只有进入明确的执行尾段才提前冻结 approved。节点 blocked 通过实例 run_status=blocked 暴露，同时保留 resume_state 和 blocked_reason，恢复只允许经过授权的 repair/reassign/retry 命令。

| 当前 decision_status / run_status | 事件与条件 | 下一状态 | 同事务处理 |
|---|---|---|---|
| 无实例 | commit 成功 | pending / reviewing | 创建首个活动节点、任务、事件 |
| pending / reviewing | 当前节点通过，还有人工/条件/办理节点 | pending / reviewing | 关闭已满足任务、激活下一节点 |
| pending / reviewing | 有权评审人最终拒绝 | rejected / completed | 关闭未完成任务、取消计时/未发作业、拒绝回执 |
| pending / reviewing 或 awaiting_amendment 或 blocked | 合法撤回且无不可逆动作 | withdrawn / completed | 保留历史，关闭待办/计时 |
| pending / reviewing | 合法请求补充 | pending / awaiting_amendment | 暂停任务，保存补充要求和计时处理 |
| pending / awaiting_amendment | 确认重新提交 | pending / reviewing | 新 revision/round，旧未决任务 superseded，按重审策略重新激活 |
| pending / reviewing | 人员/依据缺失或节点故障 | pending / blocked | 保存恢复位置、原因与接管事件 |
| pending / blocked | 已授权修复且重新校验通过 | pending / reviewing | 新 assignment 或恢复原等待，不伪造已完成决定 |
| pending / reviewing | decision_only 到达 end | approved / completed | 决定结果与完成事件 |
| pending / reviewing | 到达 execution 尾段、缺独立执行确认 | approved / awaiting_execution_confirmation | 冻结材料/批准依据，创建执行待确认项 |
| pending / reviewing 或 approved / awaiting_execution_confirmation | 所需执行确认/授权齐备 | approved / executing | 创建唯一 action_run 与 execution_job/outbox |
| approved / executing | 所有必需 action 有成功回执并到达 end | approved / completed | 聚合真实结果，关闭执行待办 |
| approved / executing | 确定执行失败或结果不确定 | approved / execution_failed 或 execution_uncertain | 保留已成功动作、失败/未知原因与恢复入口 |
| approved / execution_failed | 授权重试，确认未提交或具备可靠幂等条件 | approved / executing | 复用 effect key，对指定 action 重试，不重跑整单 |
| approved / execution_uncertain | 查询/人工核对取得确定证据 | approved / executing、execution_failed 或 completed | 追加核对证据；仅未执行部分可继续 |

审批终态 rejected/withdrawn 不可恢复成 pending；需要重新申请时新建实例并关联原单，不改写历史决定。approved 后不允许通过撤回 API 抹除批准或已执行结果，补偿另走已发布业务动作。

节点状态为 active/awaiting_input/blocked/succeeded/rejected/cancelled/superseded；尚未到达的节点只存在于定义，不提前创建假 pending 实例。任务状态为 queued/pending/suspended/approved/rejected/completed/transferred/closed；duty=review 才允许 approved/rejected，handler/consult 用 completed。

不变量：每实例至多一个非终态业务节点；每任务至多一条有效最终决定；node.material_revision 必须对应当前适用 revision；历史轮次不能产生新动作；任何终态实例不存在可执行旧 timer；外部失败不回滚已经成立的人工批准。

## 6. 事务、幂等与事件

所有本地正式命令遵循统一模板：

```text
authenticate + authorize_current_access
lookup command by (tenant,actor,action,resource,key)
  found + same payload -> reauthorize + project current receipt
  found + different payload -> conflict
validate preparation and policy/source evidence
transaction(connection):
  claim command unique key (race loser reloads winner)
  recheck local auth epoch and CAS resource versions
  consume preparation using conditional update
  apply state transition
  append immutable decision/event
  enqueueExecutionJob(..., {db: connection}) + dispatch outbox
  complete command result references
commit
return authorized receipt
```

PostgreSQL 并发使用现有 adapter/事务与条件 UPDATE；必要时 repository 层显式加行锁。SQLite 用 txImmediate 控制写竞争。PostgresSyncConn 目前将 BEGIN IMMEDIATE 转为 SERIALIZABLE，需将 serialization failure/deadlock 作为可有限重试的本地事务错误处理；不假定 SQLite 通过即可证明 PostgreSQL 并发通过。初始上限 3 次本地重试，耗尽返回 CONCURRENT_MODIFICATION 与重试入口。

禁止嵌套调用另一个 tx；下层必须接收已打开 db connection。命令事务中不 await 网络/模型/通知。所有事件、timer 和 outbox 与决定同事务写入，确保进程退出后能够继续。

事件序号在实例版本 CAS 成功后分配，每实例严格递增；列表/详情可从事件重建辅助投影，但源表是正式状态。事件至少包含命令 ID、操作者、对象范围、前后版本、规则和组织版本、原因、结果/回执引用；日志只记引用和脱敏摘要。

幂等语义是本地 exactly-once 状态提交与下游可核对执行，不宣称跨远端系统无条件 exactly-once。远端不支持幂等/查询时，可能提交后的异常进入 uncertain，不自动重试。

## 7. 权限、隔离与检索

访问层必须接收不可为空的 AccessContext：tenant_ref、actor_ref、身份类型、当前组织/权限版本、可访问对象范围、适用 Agent 链。tenant_ref 来自服务端，不从 query/body 信任。

模板管理权限细分为 read/edit/publish/disable；可由当前治理授权映射，不要求另建整套权限产品。requireAdmin 只是入口资格，仍校验流程治理 scope。owner_ref 是责任人，不因填入某人名字自动授予管理权。

实例读取通过 requester/参与任务/抄送或明确审计授权与当前业务范围交集；管理员不得天然看到所有业务材料。字段级返回前脱敏。候选列表只显示有资格且调用人可见的人；服务端保留完整授权依据供有审计资格者读取。

列表/搜索/徽标/超时/通知使用同一个受权查询构造器，先 SQL 范围过滤再排序分页。分页 `(created_at,id)` 或任务 `(activated_at,id)` 稳定游标；默认 30、最大 100 为技术限制。count 与列表使用相同 scope、filter 和查询时点约定；缓存 key 含 tenant/actor/auth_epoch/filter，撤权后失效。

附件下载、事件流与回执重放同样重验。事件订阅重连用 sequence，重复不重复展示；权限变化立即停止返回受限事件。远端可见性事实不可用时 fail closed，显示“当前权限无法核验”，不把故障当空列表。

## 8. HTTP 契约

### 8.1 路由版本

新接口在原路由体系下使用 `/api/approvals/v2`、`/api/admin/approval-types/v2`，避免与现有 `/:aid`、`/:id` 响应形状冲突。挂载顺序必须在动态 ID 路由之前，并以路由测试覆盖。旧接口保持原契约，只在服务层做兼容适配。

所有写请求返回 schema_version、request_id、资源版本与 receipt；草稿保存不要求 L3 确认，正式生效命令统一要求 Idempotency-Key 与对应 preparation。决定/发布/停用等先调用各自 prepare-action，避免把申请提交确认用于其他动作。

### 8.2 员工接口

| 方法及路径（相对 /api/approvals/v2） | 输入要点 | 输出/行为 |
|---|---|---|
| GET /capabilities | 当前身份 | 支持字段/节点/模式的实现版本；能力清单不授予业务权限 |
| GET /templates | cursor、query、category | 授权模板摘要、active_version_id |
| GET /templates/:id/definition | published_version_id | 员工表单和允许的业务说明，不返回治理秘密 |
| POST /drafts | template_version_id、form、object_ref | draft_id、revision、issues |
| PUT /drafts/:id | expected_revision、form | CAS 保存后的 revision；422 错误定位 |
| POST /drafts/:id/prepare | expected_revision | confirmation_id、预览与摘要、expires_at |
| POST /instances | confirmation_id、expected_draft_revision；幂等头 | 201 首建；200 重放；唯一 instance_id |
| GET /instances | box、filter、cursor | 授权行、next_cursor、count_scope |
| GET /instances/:id | 无 | 详情、当前版本、允许动作、独立执行结果 |
| GET /instances/:id/events | after_sequence | 按序分页事件，或同契约流式传输 |
| GET /instances/:id/assignees | action、task_id、query、cursor | 目标候选及资格解释，目标提交前重验 |
| POST /instances/:id/prepare-action | action、task_id、expected_versions、target/reason | 动作后果、风险、确认摘要 |
| POST /instances/:id/commands | action、confirmation_id、expected_versions；幂等头 | 持久命令回执与最新授权投影 |
| POST /instances/:id/amendments | expected_revision、获准变更 | 新补充草稿，随后 prepare 和 resubmit 命令 |
| GET /commands/:id | 无 | 当前授权下的回执，用于超时恢复 |

GET 模板 definition 不返回完整未来参与者私密范围；执行服务持有全定义。preview 对前序结果依赖节点返回 pending_resolution，其原因和规则摘要可见，不能伪造具体人。

### 8.3 管理接口

| 方法及路径（相对 /api/admin/approval-types/v2） | 关键行为 |
|---|---|
| GET /templates、POST /templates | 范围内列表、创建空草稿；不自动注入费用图 |
| GET /templates/:id/versions | 不可变发布版本及有效状态 |
| POST /templates/:id/draft | 基于指定发布版复制草稿，已有工作草稿返回冲突/原草稿 |
| GET/PUT /templates/:id/draft | 获取/按 expected_revision 保存完整文档，返回 document_hash |
| POST /templates/:id/draft/validate | 对确定 revision 生成结构和依赖报告 |
| POST /templates/:id/draft/simulate | 对同一 revision/hash 运行明确测试值，返回字段错误/节点路径/解析依据 |
| POST /templates/:id/prepare-action | publish/disable/enable 等作用范围和差异确认 |
| POST /templates/:id/publish | confirmation_id、draft_revision、document_hash、validation_report_id、expected_template_version；幂等头 |
| POST /templates/:id/commands | enable/disable；不影响已运行实例的隐式终止 |
| GET /reference-options | 合法字段源、角色、业务动作、策略；按治理权限过滤 |

发布事务校验草稿 revision、内容 hash、报告依赖版本、当前发布指针；生成新 version_no 并切换 active_version_id。相同内容重复发布返回已有结果。新版本只影响新发起；已准备未提交的旧版本申请提示版本变更并重新预览，首版不提供旧版本宽限期。

### 8.4 申请预览示例

以下均为结构示例，ID 为占位符，不是可执行业务事实。

```json
{
  "schema_version": "review.api.v1",
  "request_id": "req_example",
  "confirmation_id": "rpc_example",
  "draft_revision": 4,
  "template_version_id": "rv_example",
  "material_hash": "sha256:example",
  "expires_at": "2026-10-04T09:10:00Z",
  "summary": {
    "title": "提交内容评审",
    "risk": "L3",
    "consequence": "创建评审单，尚不发布内容",
    "fields": [{"key": "content_ref", "label": "待评审内容", "display": "视频初稿 · 第3版"}]
  },
  "path": [{"node_id": "review_content", "resolution": "resolved", "participants": [{"principal_ref": "user:example", "name": "示例评审人"}]}],
  "blocked": false
}
```

### 8.5 决定命令示例

```json
{
  "action": "approve",
  "confirmation_id": "rpc_decide_example",
  "task_id": "rpt_example",
  "expected_versions": {
    "instance": 8,
    "node": 3,
    "task": 1,
    "assignment": 2,
    "material_revision": 1
  }
}
```

返回 `{command_id,replayed,instance_id,instance_version,decision_status,run_status,receipt}`。receipt 只证明本次决定是否保存、节点是否推进、是否有后续业务执行，不将本地成功包装为外部成功。

### 8.6 错误契约

统一 `{detail:{code,message,issues?,current_versions?,recovery?},request_id}`；issues 使用 field/node/edge 的稳定 ID 路径。不可见资源返回 404；已可见资源的动作资格不足返回 403。

| HTTP | code | 恢复行为 |
|---|---|---|
| 400/422 | SCHEMA_INVALID / FORM_INVALID / GRAPH_INVALID / CAPABILITY_UNSUPPORTED | 定位字段或节点修改，不自动提交 |
| 403 | ACTION_NOT_ALLOWED / ASSIGNEE_INELIGIBLE | 刷新允许动作/候选，不能通过改前端绕过 |
| 409 | PREVIEW_STALE / VERSION_CONFLICT / NODE_ALREADY_RESOLVED | 保留输入，加载差异后重新确认 |
| 409 | IDEMPOTENCY_CONFLICT | 查询原命令；不能盲换 key 重做 |
| 409 | CONCURRENT_MODIFICATION | 服务端本地重试已耗尽，读取当前状态再操作 |
| 410 | CONFIRMATION_EXPIRED | 重新 prepare |
| 422 | RULE_UNRESOLVED / ASSIGNEE_UNRESOLVED | 展示负责人/补齐入口，仅阻断依赖节点或发布 |
| 503 | AUTHORITY_UNAVAILABLE / FACT_SOURCE_UNAVAILABLE | 保留草稿、可重试，不使用默认事实 |
| 202 | 命令已接收但外部执行 pending/uncertain | 返回 command/action_run 引用；继续查询状态 |

## 9. 超时、通知与执行 worker

review_timer_scan 作为新 handler 注册到现有 cron/handlers.ts、handlerContract、治理目录和调度 seed。handler 的可用性、风险、服务身份、租户范围、触发、去重、取消、恢复、终态与接管必须齐备；注册函数不等于自动调度已部署。

扫描查询到期 timer，并在事务中 CAS `pending -> queued` 与创建 execution_job/outbox。job payload 只含引用、策略版本与预期节点/assignment；作业执行时重新加载当前状态。过期版本返回 skipped 并记录原因，不转交当前新节点。

同一个 timer_id 使用唯一 effect key；任务租约到期由现有 worker 恢复。增加 fence 令旧 worker 失去完成/写回资格；外部投递依赖通道幂等与回执核对，fence 本身不能阻止已发出的远端请求。

升级目标通过与人工转交相同的资格服务解析，并按明确预授权执行；不能无 actor/expected_version 调用旧 transferApproval。无目标进入 blocked/needs_takeover，不兜底 CEO。升级、通知、计时重建和历史记录在一次本地事务内。

通知先生成收件人引用与最小摘要，投递前再校验权限与当前地址；禁止把全量表单常驻通知 payload。撤权后不继续投递旧敏感材料，已投递的外部消息不能声称撤回。界面显示投递失败/结果待核对与重试入口。

工作日时限必须绑定 calendar_ref/version 与时区；首版若只实现 elapsed_duration，就明确不支持工作日策略。时限数值取业务配置，调度扫描频率取技术配置；不能用扫描晚到时间重算业务 deadline。

## 10. 前端详细交互

### 10.1 路由与页面状态

员工路由保留 `/approvals`；新增 `/approvals/new`、`/approvals/drafts/:draftId`、`/approvals/:instanceId`。管理端保留 `/admin/approval-types`，详情进入 `/:templateId`，面板通过 query=basic/form/flow/publish 保存。具体 React 路由匹配先放静态 new/drafts，再放动态 ID。

员工工作台默认待我处理，切换列表不把其他筛选的 focused 单据插回结果；详情路由独立表达焦点。发起入口为辅助按钮；进入申请页面后“检查申请”为唯一主 CTA；确认弹窗打开时背景主 CTA 降强调。

每个资源明确 idle/loading/loaded-empty/loaded/error/forbidden 状态；错误不显示“没有流程”。请求附 request-generation 或取消信号，旧响应不能覆盖新模板、字段或筛选。队列更新不抢走当前阅读/确认焦点。

草稿按服务器 revision 保存；刷新从服务器恢复。网络失败保留当前内存输入并标未保存，不把敏感表单无条件写 localStorage。跨路由有未保存变更时提供保存/放弃/继续编辑。附件单独显示上传中/成功/失败，成功引用才能提交。

### 10.2 设计器状态与命令

```text
EditorState:
  templateId, draftId, serverRevision
  document, savedDocumentHash
  selection(nodeId|edgeId|null)
  validationReport, simulationResult
  saveState, conflictState
  history(past,present,future)
```

父级 reducer 是唯一 document 来源。画布只接受 value/onCommand；不再按 initial.nodes ID 集合判断是否同步。切换模板用 templateId+draftId 更换完整上下文，清选中态和历史。

命令：AddNode、UpdateNode、RemoveNode、AddBranch、UpdateBranch、ConnectEdge、DisconnectEdge、SetStart、MoveNodes、AutoLayout、UpdateField、ReorderFields。节点删除同时处理引用并产出错误定位，不自动改业务流向。稳定 edge ID=`source+branch_id`，默认分支使用固定 default 标识。

拖动时保存临时位置，pointerup 一次提交 MoveNodes；取消拖动不写历史。不可变更新所有受影响节点，撤销恢复完整前态。节点 click 停止空白取消事件；只有点击画布背景才取消选择。触摸用 pointer events 与 pointer capture；列表操作提供不拖拽等价路径。

所有执行语义编辑使验证/试运行失效，纯布局改动也使发布 document_hash 失效并要求重新确认保存；可以复用 runtime_hash 对应的语义验证结果，但发布校验要明确生成覆盖当前文档的新报告。

### 10.3 表单/属性/错误处理

节点参与人显示已选职责、解析结果/待解析原因、来源版本，不要求输入 employee_id。默认分支固定可见；每条条件有独立出口。不能用颜色作为唯一命中/选中/错误标记。

表单编辑器支持字段预览、稳定字段 key、选项编辑和条件构造。危险修改如删除被条件引用的字段要列出影响并保留修复入口，发布前不允许悬空引用。

验证面板逐条展示问题、严重度、所属 field/node/edge，点击定位并聚焦；有 blocking issue 时发布不可用，说明原因。模拟页面明确“无真实提交”，不得创建正式审批或投递通知。

发布确认包括旧/新版本、表单/范围/节点/动作差异、验证覆盖、影响范围和在途实例处理。确认只覆盖该 document_hash；后端拒绝保存后内容变化的旧确认。

### 10.4 实例详情与动作

摘要 → 当前待处理事项 → 申请材料/版本 → 流程轨迹 → 决定区 → 历史/回执。同一状态只在一处主要表达；历史节点可展开，不在通知栏重复整份轨迹。

UI 只渲染 allowed_actions；受控动作打开专属确认组件，使用服务端 consequence 文案。撤回不叫驳回，征询不叫加签审批。版本冲突保留理由输入，显示材料变化并要求重新确认，不直接重放新的决定。

审批权限失效时立即关闭待确认动作或使提交返回拒绝，并显示刷新/接管原因；不能继续以旧页面按钮操作。已批准但执行失败的单据保留批准决定，单独显示执行恢复，不要求再次批准来重试同一副作用。

### 10.5 视觉与无障碍

继续采用 data-dense-dashboard、DESIGN token 与既有 ConfirmDialog/焦点锁。属性栏窄时单列、关键动作区不被滚动遮挡；布局按宽度、高度、输入模态分别处理，不用 UA 判断设备。

可点添加/连接/移动与键盘编辑均提供；读屏暴露节点标题、类型、顺序/关系、选中与错误。SVG 不是唯一功能入口。发布/确认后恢复焦点到触发元素或对应回执行；减弱动效禁用平滑滚动/脉冲。

按 DESIGN §13 验证深浅色、200%缩放、触摸命中区、短高度操作区和单主 CTA。数值不在本设计另立来源。

## 11. 运维、迁移与回退

分别控制新模板治理、新流程发起、后台 timer、新外部动作的开关，开关只限制新动作，不隐藏已发生回执。开关配置走现有治理与发布体系，不靠修改浏览器状态。

迁移过程：建表/索引 → 注册能力但不开放新提交 → 导入模板为待核验草稿 → 核实业务规则与组织映射 → 影子预览比较 → 开放授权测试模板 → 定向验收 → 灰度新发起。导入不能原样自动发布存在未知规则或不支持节点的旧类型。

历史实例不重算链。legacy 适配可以先继续使用旧存储，但所有新命令需补当前权限/版本/确认/幂等闸门；不因 legacy 标记豁免安全修复。无法确定材料/规则版本的未完成单据标记 needs_review 并限制生效决定，由有权人员核验；只读历史仍按当前权限可见。

新旧 ID 用 engine_version 与 legacy_refs 区分；旧 URL 解析到对应引擎，禁止默默给同一旧 ID 返回新契约。新发布版本在回退时可停止新发起，已有 v2 实例继续由兼容 worker 排空或进入可恢复暂停。不得将仍有 v2 实例的部署直接回退到完全不识别新 schema 的旧二进制。

观测指标：待办积压/最久等待、阻断原因、版本冲突、幂等重放、权限拒绝、timer 延迟、通知投递、execution uncertain、outbox 重试。指标按授权范围聚合，不含表单正文。审计可按 instance/command/action_run 贯通。备份恢复覆盖定义版本、材料引用、命令回执、事件序号、计时和 outbox 处理位置。

## 12. 决策清单与交付边界

本设计已确定技术选择：版本化定义、单活动节点 DAG、节点内多人任务、AST、单状态设计器、服务端 prepare/command、复合租户约束、事务 outbox、节点版本计时与独立业务执行状态。

以下由业务负责人按模板提供，不是要求用户逐项批准技术实现：制度/角色来源、自批与代理例外、否决规则、发起/材料范围、转交/加签/撤回权限、补充材料策略、时限与升级授权、通过后的动作。业务配置未齐时草稿可保存、界面可开发、技术测试可用显式夹具；相关生产模板不可发布。

本轮文档通过契约交叉检查与内部链接检查，不代表数据库迁移、接口、页面或真实业务集成已实现。后续完成状态与验证证据按配套实施计划维护。
