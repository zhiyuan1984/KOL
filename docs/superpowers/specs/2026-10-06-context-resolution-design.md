# 技能上下文解析层设计

状态：P0 设计定稿；P1 已实施（解析层 + 只读入口，21 例测试含 4 例 `mail.prepare` 行为回归）；P2.1 已实施（`confirm_stage` / `stage_sop` 声明 context，运行箱补齐阶段事实，运行路径加缺口闸门；29 例测试）；P2.2–P2.4 与 P3 未开始。实施状态以 [implementation-registry.md](../../implementation-registry.md) 为准。
依据：[CONSTITUTION.md](../../CONSTITUTION.md) CONST-03/04/05/08/10、[PRODUCT.md](../../PRODUCT.md) PROD-AGENT-01/02/03/09、[TECHNOLOGY.md](../../TECHNOLOGY.md) TECH-ARCH-02、TECH-BE-01/04、[BUSINESS.md](../../BUSINESS.md) BIZ-04、[DESIGN.md](../../DESIGN.md) §8.8、[07-mcp-data-contract.md](../../07-mcp-data-contract.md)。
前身：[2026-09-23-skill-routing-param-memory-design.md](2026-09-23-skill-routing-param-memory-design.md)（ADR-2026-09-23）。本文件不替代它；它定义的是**参数**契约，本文件补齐**上下文**契约。

## 设计哲学

总纲：**参数由人给，上下文由系统解析；两者都必须在执行前就有明确结论，解析不出来的部分如实回执。**

1. **事实与输入分开。**「粉丝数 10 万到 50 万」是人提供的**值**，属于 `input_schema`；「当前这个红人是谁」「当前合作在哪个正式阶段」「当前用户挂载的发件箱是哪个」是系统应当**解析**出的事实，属于 `context`。把事实塞进 `input_schema` 会让人手填本可自知的信息（现行 `email_compose` 三字段手填即此）；
   把输入塞进 `context` 则会伪造系统自知能力。
2. **声明什么，就必须能被追问。** 现行缺口可见性取决于是否声明 `required_inputs`：空数组让 `missing()` 恒为空（`backend/src/tasks/resolver.ts:242-269`），45 个技能因此在上下文缺失时**系统永不追问**。本设计把「空」变成一种显式声明——**这个技能确实不依赖当前世界**，而不是默认值。
3. **解析在 Host，不烧模型 turn。** 沿用 ADR-2026-09-23 的判断：「必要参数在 Host 层用结构化控件补齐（便宜、可校验），不烧 Codex turn 来回问；建箱时 CONTEXT pack 因此更完整，一次成功率更高」。上下文同理，且更廉价——多数来源是本地已查过的行。
4. **一个通用解析器，不是每技能一个专用接口。** 现行 `mail.prepare`（`backend/src/host/api.ts:429`）是好实现但不可复用：第一行就硬校验 `skill_id === "email_compose"`（`api.ts:431`），全后端仅此一个上下文准备动作。本设计把它泛化为解析层的**第一个消费者**，而非唯一形态。
5. **来源必须可审计。** 每一片上下文都要能说出「命中了哪条来源、依据是什么」。解析结果与 `context_version` 一起进运行箱，供技能与证据链追溯。

收益：新增技能只需声明需要哪几片上下文，不必再手写解析器；「必须指定达人 UID」这类前置条件（现仅存于 `creator_contact_decrypt/SKILL.md:25` 的散文）第一次成为系统闸门；缺口呈现从「45 个技能静默」收敛为一个统一契约。

## 现状勘测（改前）

| 设计要求 | 现状 | 结论 |
|---|---|---|
| 技能声明的输入有类型与来源 | 50 个技能中 6 个声明 `input_schema` | 部分满足（ADR-2026-09-23 试点迁移未完成） |
| 缺失必填项会拦截并澄清 | `required_inputs` 非空者仅 5 个；空数组恒不拦截 | ❌ 45 个技能静默 |
| 上下文由 Host 统一解析 | `mail.prepare` 硬编码 `skill_id === "email_compose"` | ❌ 单技能专用 |
| 界面选中态可进入提交 | `object_refs` 已随提交载荷传递（`ComposerDock.tsx:914`） | ⚠️ 管道已铺，全后端仅 `api.ts:286` 一个消费者 |
| 运行箱携带当前世界 | `CONTEXT` 仅 `collaboration` / `compose_route`（邮件专用）/ `mailboxes`（品牌常量白名单）/ `overdue`（`risk_scan` 专用且无归属过滤）/ `mail_digest` | ⚠️ 覆盖窄且不对称（`backend/src/worker/runner.ts:489-534`） |
| 阶段事实可用于 SOP 类技能 | 仅 `stage_code`；`stage_version`、异常、`advancement_mode` 均未进运行箱 | ❌ 阶段类技能无法区分「发信即可」与「发信 ≠ 推进」 |

## context 契约

与 `input_schema` 并列，住在 SKILL.md frontmatter（单一事实源，沿用 ADR-2026-09-23 的存储决定）。

**写法约束**：frontmatter 解析器是逐行 `key: value` 的平面解析器（`registry.ts` 的 `frontmatter()`），**只接受单行 JSON 兼容值，不支持块状嵌套 YAML**。多行块会以 `manifest context must be an object` 在加载期拒绝整个技能目录。因此 `context` 与既有 `memory_policy` / `supports` 同写法，写在一行：

```yaml
context: {"requires":["collaboration","stage"],"prefers":["stage_tracks"]}
```

字段语义：

| 键 | 类型 | 含义 |
|---|---|---|
| `requires` | string[] | 解析失败即 `needs_context`，不给执行；前端出结构化缺口卡 |
| `prefers` | string[] | 解析失败不阻塞，但要在运行箱与员工面如实标注「未取到」 |

规则：

1. **`context` 与 `input_schema` 互不替代**：同一技能可同时声明两者（`email_compose` 即如此——`input_schema` 管模板变量，`context` 管合作/阶段/发件箱）。
2. **键名来自登记目录**（下表），不得自创；未登记键在契约校验期拒绝加载，与 `input_schema.options_source` 同一处置（`registry.ts:364-366`）。
3. **`requires` 为空数组是显式声明**，表示该技能不依赖当前世界（如 `email_mailbox_list`、`creator_library_all`）。未声明 `context` 的技能保持现状并标为「上下文契约待补」，**不批量伪造**（沿用 ADR-2026-09-23 §6 的纪律）。
4. **声明 `requires` 即获得闸门**：解析失败走 `needs_context`，不建箱、不启动 Codex turn。

### 已登记上下文键

| 键 | 解析出的内容 | 主要来源 |
|---|---|---|
| `collaboration` | 合作对象行（id / handle / brand / email / mailbox_from / stage_code） | 显式载荷 → UI 选中 → 会话绑定 → 文本 `@handle` |
| `stage` | 正式 `stage_code`、`stage_version`、`advancement_mode`、是否异常 | 合作对象行 + 阶段图 |
| `stage_tracks` | 三轨与 `legalTargets` | 阶段图（`stages.ts` / `groupedStageTracks`） |
| `mailbox` | 授权发件箱（`from` / `send_from` / 来源档） | `compose-sender.ts` 单一规则 |
| `mail_thread` | 最近往来摘要与条目数 | `composeContextForCollaboration` |
| `mail_template` | 适用且已发布的邮件模板快照 | 知识库解析器 |
| `message` | 当前邮件消息（id / 正文 / 方向 / 时间） | 显式载荷 → UI 选中 → `object_refs` |
| `conversation` | 当前邮件会话 | 显式载荷 → UI 选中 → 文本抽取 |
| `creator` | 当前红人/达人（uid / handle / name） | 显式载荷 → UI 选中 → 文本抽取 |
| `creator_filter` | 当前达人库筛选口径 | UI 筛选态 → 显式载荷 |
| `risk_scope` | 风险范围（归属、品牌、阶段） | 当前用户范围 + 显式载荷 |

## 来源优先级链

固定顺序，逐级回退；任一级命中即停止（除 `mailbox` 需过品牌与范围核对，可能继续降级）：

```
1 显式载荷（前端明确传入）
2 UI 选中态（object_refs）
3 会话绑定（session.collaboration_id）
4 文本抽取（extractTaskEntities）
5 账号绑定（user_starry_bindings 等）
6 对象事实（合作行/达人行自身字段）
7 记忆（已登记记忆范围）
```

规则：

- **显式载荷优先于一切**，且与 `input_schema` 的 `prefill` 同序（`resolver.ts:344-359` 已有此顺序，解析层复用）。
- **冲突不静默**：第 1 级与第 3 级给出不同合作对象时，返回冲突而非取其一（`preparedCollaboration` 已有该语义，`api.ts:259-261`，本设计沿用为通用规则）。
- **第 5 级只在品牌与范围核对通过时使用**（BIZ-04、`compose-sender.ts` 头注）；任何一步不得从多候选中取第一只。
- **第 6 级不做推断**：对象行上的字段缺失就是缺失，不猜（`docs/AGENTS.md` §5 不伪造事实）。

## 解析结果信封

统一返回，泛化自现行 `ComposePrepare`（`api.ts:202-212`）：

```ts
type ContextResolution = {
  status: "ready" | "needs_context" | "needs_input" | "blocked";
  skill_id: string;
  resolved: Record<string, unknown>;      // 逐键的解析结果
  sources: Record<string, string>;        // 逐键的来源档（可审计）
  missing: Array<{ key: string; tier: "requires" | "prefers"; reason: string }>;
  candidates: Array<{ key: string; id: string; label: string }>;  // 多候选待人选
  context_version: string;                // 防漂移哈希
};
```

- `context_version` 沿用现行实现（`api.ts:214` `composeContextVersion`）：内容变化即版本变化，旧确认快照失效（`api.ts:373-375` 的 409 语义推广为通用规则）。
- `needs_context` 只对应 `requires` 未满足；`prefers` 未满足记入 `missing` 但 `status` 仍可为 `ready`。
- 缺口呈现走 [DESIGN.md](../../DESIGN.md) §8.8「空态诚实」三分：**尚未解析 / 服务不可用 / 筛选无结果**，并给双入口（选择对象 / 手填走首封类场景）。

## 入口

新增 `POST /api/actions/context.resolve`（登记进 `backend/src/runtime/operations.ts` 的操作表，与 `mail.prepare` 同级）。

- **`mail.prepare` 保留并成为它的第一个实现**：行为、路由、响应字段不变，内部改为调用解析层；现有定向用例（`backend/tests/mail-compose-prepare.test.ts`，22 例）作为回归锁。
- 前后端契约：解析入口只读、不建箱、不启动 turn；前端按 `requires` 决定是否阻塞提交。
- 与 `input_schema` 澄清的关系：`needs_context`（系统没解析出事实）与 `needs_input`（人没给值）是两种状态，前端呈现不同卡片，**不得合并**。

## 与既有规范的关系

- **不新增第二注册表**：`context` 住 SKILL.md frontmatter，随 registry 解析与契约校验（沿用 ADR-2026-09-23 §2 的单一事实源决定）。
- **不改执行闸门**：发送确认、阶段写入、审批、L3 回执、幂等一律不动；本设计只改善「执行前拿到什么」。
- **不改权限判定**：解析层在取数、模型调用、缓存、索引前校验范围（`docs/AGENTS.md` §5），不先取全量再过滤。
- **不覆盖 DESIGN.md**：缺口卡的视觉走现行 token 与不变量，不新增专用体系。

## 实施阶段

| 阶段 | 范围 | 不改动 |
|---|---|---|
| P1 | `registry.ts` 解析 `context` 块 + 契约校验；`host/context-resolve.ts` 来源链与信封；泛化入口 | 任何技能行为 |
| P2.1 | `confirm_stage` + `stage_sop`：补 `stage_version` / 异常 / `advancement_mode` | 阶段写入闸门 |
| P2.2 | `creator_contact_decrypt` / `creator_status_update` / `creator_owner_update` / `creator_library_sync`：`requires: [creator]` | 解密授权与回执 |
| P2.3 | `email_conversation_read` / `mail_summary` / `mail_translate` / `reply_analysis`：接通当前会话/当前邮件 | 邮件读取权限 |
| P2.4 | `creator_library_query`：字典来源 + 当前筛选；`creator_lifecycle_kanban` / `risk_scan`：范围输入 | 远端查询范围 |
| P3 | 15 个 `sop_*` 的阶段一致性；文档漂移 | — |

## 测试计划

- **解析层单测**（新增）：来源链逐级命中与回退；第 1/3 级冲突；`requires` 未满足 → `needs_context`；`prefers` 未满足不阻塞；`context_version` 变化使旧确认失效。
- **契约校验**：未登记键、`requires` 与 `prefers` 类型错误、与 `input_schema` 并存时各自独立校验。
- **回归**：`mail-compose-prepare.test.ts` 22 例保持全绿（行为不变证明）。
- **E2E**（真机）：`requires` 满足 → 一次到位自动带出发件箱/收件人/往来摘要；不满足 → 出缺口卡且**不建箱**。

## 规则空白与交办（CONST-08 四档结论）

| 事项 | 结论 | 交办 |
|---|---|---|
| 「上下文」与「输入」的边界未在基本法明文 | 规则空白 | 智能体产品经理按本设计补充口径，报 PRODUCT.md |
| 15 个 `sop_*` 已判 retired 但代码仍活 | 规则空白 | 平台产品经理裁决物理退役或加阶段一致性校验 |
| 哪些上下文属于「必须解析」 | 规则空白 | KOL 业务专家按技能逐个裁定 `requires`，不由实现方自定 |
| `risk_scan` 的 overdue 快照无归属过滤 | 冲突（与 PROD-AGENT-06「按当前员工权限筛选」不符） | 后端专家修正查询范围 |

## 审宪记录（CONST-08）

- **需求**：「KOL 智能体的邮件类、达人类、阶段类等技能都做到实时感知上下文」。
- **主责角色**：智能体产品经理（入口与记忆）、平台产品经理（技能声明）、架构师（解析层）；UI/UX 专家（缺口呈现）与 KOL 业务专家（事实口径）会签。
- **宪法条款**：CONST-03（确定的状态规则由程序执行，不靠模型自觉）、CONST-04（前端不重写规则）、CONST-05（确认与回执不放松）、CONST-08（先审宪）、CONST-10（不得用文档或占位冒充能力）。
- **基本法条款**：PROD-AGENT-01（入口决定路径、路由显式登记）、PROD-AGENT-02（快捷指令声明名称/输入/结果/权限/失败处理）、PROD-AGENT-03（只追问影响当前任务的必要信息；已明确的授权与选择应复用）、PROD-AGENT-09（可靠协作与重新核验）、TECH-BE-01/04、BIZ-04（实际发件箱属于员工获准使用的品牌及范围）、DESIGN.md §8.8、07-mcp-data-contract 工具风险目录。
- **结论**：**符合**。本设计只改善「执行前拿到什么」，不新增闸门、不放松确认与回执、不改阶段或权限判定；`context` 住既有单一事实源（SKILL.md frontmatter），不建第二注册表；未声明 `context` 的技能保持现状并如实标注，不伪造支持状态。
- **下一步**：P1 实施解析层并用 `mail.prepare` 回归锁定行为不变；P2 按「业务痛感」逐类迁移；每阶段附类型检查、定向测试与真机走查证据。

## 限制

- 本设计解决「上下文如何被声明与解析」，**不解决**远端 MCP 工具 schema 的不确定性——真实可用的筛选参数需运行时 `execution.discover()` 从远端获取（`backend/src/worker/runner.ts:723`），仓库内只有 mock 与确定性分支。
- 现行 `backend/src/starrykol/service.ts:2170+` 的 `needs_input` 确定性兜底在生产**不可达**（`session-items.ts:643-651` 非 stub 模式直接抛 `CodexUnavailable`）；P2 迁移后的行为需真机验证，不能只凭单测。
- `context` 的键目录由本设计登记，后续新增属规范变更，须按 CONST-08 复核。
