# 知识库非结构化层详细设计——PageIndex 本地模式 + 多模态规整层

> 日期：2026-10-02
> 状态：设计稿（确认后落档；本文件是实施规格，不声明生产代码已经完成）
> 范围：非结构化知识库（`knowledge_bases.kind='unstructured'`）的**资料加工流水线**——上传 → 规整 → 索引 → 待审 → 发布 → 检索（P1 仅管理端试算）
> 前置决策（用户 2026-10-02）：引擎选 **PageIndex 本地模式**；检索**直接让 PageIndex 给答案**；文档级授权 **v1 用「发布即可见 + 品牌/范围」**；音视频产出**全文转写稿 + 摘要**；**P1 先只开管理端**。
> 关联：[CONSTITUTION.md](../../CONSTITUTION.md)、[PRODUCT.md](../../PRODUCT.md)、[TECHNOLOGY.md](../../TECHNOLOGY.md)、[DESIGN.md](../../DESIGN.md)、[ia-information-architecture.md](../../ia-information-architecture.md)、[org-permissions.md](../../org-permissions.md)、[07-mcp-data-contract.md](../../07-mcp-data-contract.md)、[DECISIONS.md](../../DECISIONS.md) ADR-2026-10-01（三）、[specs/2026-09-26-knowledge-base-skill-agent-design.md](2026-09-26-knowledge-base-skill-agent-design.md)、[db-data-dictionary.md](../../db-data-dictionary.md)
> 外部依据：PageIndex 本地模式与 SDK（`pip install pageindex`；本地索引只收文本型 PDF、存储本地目录、引用页级；`chat(doc_id=string|List[string])` 支持多文档、`citations=True` 产出 `<cite doc page/>` 并可 `resolve_citations()`；MIT；Alpha 阶段）；链接见 §13。

## 1. 范围与决策

### 1.1 本设计覆盖

1. **资料（Document）**：非结构化库里的一份源文件（视频 / 音频 / PDF / PPTX / 图片），及其生命周期。
2. **规整层**：把任意输入变成「文本型 PDF（+ 可溯留档稿）」的加工步骤，由多模态大模型与格式转换承担。
3. **索引层**：PageIndex 本地模式（Python 侧车）为每份规整稿建树索引；每库一个本地库目录。
4. **治理**：文档状态机、作业与真实进度、取消/重试、待审与发布（审核后生效）、审计与成本归集。
5. **检索（P1）**：仅管理端试算——对已发布资料（或审批前的单份资料）提问，**直接返回 PageIndex 的答案 + 页级引用**。
6. **管理端交互**：入库视图解禁与升级；非结构化库详情改为资料列表 + 试算面板；待处置新增待审资料。

### 1.2 已确认决策

| # | 决策 | 说明 |
|---|---|---|
| 1 | 引擎 = PageIndex 本地模式 | 不引向量库、不引 embedding、无 GPU；不采用 PageIndex Cloud（数据出本机） |
| 2 | 检索形态 = 直接给答案 | 使用 PageIndex 的 `chat()` 文档问答（自带 LLM key，OpenAI 兼容端点）；返回答案 + 页级引用；不做「只给片段让 Agent 自行作答」的 v1 路径 |
| 3 | 授权 v1 = 发布即可见 + 品牌/范围 | 文档级 grants 后续批次做；管理端页面显式标注这一限制 |
| 4 | 音视频产出 = 全文转写稿 + 摘要 | 转写稿（md）留档可溯；摘要并入规整稿；其余格式同理保留中间产物 |
| 5 | P1 仅管理端 | 试算验证质量后再开 Worker/Agent 检索通道（P3） |

### 1.3 明确不做（本设计外）

- Worker/Agent 检索工具与「知识问答」技能面（P3）。
- 员工 `/kb` 的非结构化阅读体验（P3；P1 员工面继续显示「未实现」标注，不伪装）。
- 文档级 grants、人审流转「退回」以外的编辑能力。
- PageIndex Cloud / File System / MCP server / 块级引用与 OCR（Cloud-only 能力不用）。
- 结构化层（条目/模板/词表）任何改动；旧 `knowledge_raw` + `knowledge_extract_jobs`（raw→候选）路径保持不动，仅服务失败会话留档与结构化候选。

### 1.4 审宪记录（CONST-08）

| 项目 | 记录 |
|---|---|
| 需求 | 非结构化层：PageIndex 本地 + 多模态规整层；直接给答案；发布即可见+品牌/范围；音视频全文转写稿+摘要；P1 仅管理端。 |
| 主责角色 | 架构师（引擎与侧车边界）；智能体产品经理（知识进入 Agent 的通道分期）；平台产品经理（治理与状态机）；UI/UX 专家（管理端呈现）；后端/前端专家（实现）。 |
| 宪法条款 | CONST-03（规则由代码强制）、CONST-05（读/草稿/正式动作分清）、CONST-06（来源、版本与时间可溯）、CONST-09（细则修订留痕）、CONST-10（不得以假进度/未实现冒充）。 |
| 基本法条款 | PROD-PLAT-04/05；PROD-AGENT-04~07（知识进入上下文的受控通道）；TECH-ARCH-01（新组件与依赖的依据、边界、迁移影响）；TECH-BE-01/02/06/08、TECH-FE-01/03、TECH-TEST-01/02；细则：DESIGN 不变量 1/2/4、ia §2#5/§3/§4、org-permissions（范围与确认/回执）、07-mcp-data-contract（真实调用与异步契约）。 |
| 结论与证据 | **符合（含一处 ADR 修订待办）**：① 「审核后生效」沿用现行口径（ADR-2026-10-01（三）第 3 条），索引完成先入待审，发布才可检索；② 分类不承载权限、授权与品牌/范围过滤先于检索（PROD-AGENT-06）；③ 进度、失败、取消、重试均为真实状态（CONST-10）；④ 引擎由 WeKnora 改为 PageIndex + 多模态规整层，属该 ADR「非结构化另案」的落点，需在该 ADR 增补修订记录（见 §14）。 |
| 下一步 | 本文档确认 → 落档（ADR 修订、旧 spec 指针、实施登记）→ P1 实施（实施计划另附 `plans/` 文档）。 |

## 2. 术语

| 术语 | 含义 |
|---|---|
| 资料（Document） | 非结构化库中的一份源文件及其加工状态；本设计的新对象。 |
| 规整稿（Normalized PDF） | 规整层产出，统一的**文本型 PDF**，是 PageIndex 本地模式的输入。 |
| 转写稿 / 留档稿 | 音视频的全文转写（`transcript.md`）、Office/扫描件的中间文本（`extracted.md`），仅留档与人工核对，不直接进索引。 |
| 作业（Job） | 一次规整或索引的加工尝试（含重试历史）。 |
| 本地库目录（Library） | 每个非结构化库一个 PageIndex 本地库目录，承载该库全部文档的树索引。 |
| 侧车（Bridge） | `backend/tools/pageindex-bridge/` 下的 Python 桥，封装 PageIndex SDK，对 Node 暴露 JSON 契约。 |

## 3. 总体架构

### 3.1 分层

```
上传（视频/音频/PDF/PPTX/图片）
   │  ① Host：落盘 + 建资料行（uploaded）+ 入队（normalize）
   ▼
规整层（Node 编排；多模态模型 API）
   │  音频/视频 → 分段转写 + 摘要 → 文本型 PDF（+ transcript.md）
   │  扫描件/图片 → 视觉模型 OCR/理解 → 文本型 PDF
   │  PPTX → 逐页文本与备注提取 → 文本型 PDF（转换器试点后锁定）
   │  文本型 PDF → 直通（校验文本层可用）+ 密钥扫描
   ▼
索引层（Python 侧车；PageIndex 本地）
   │  index：规整稿 → 树索引（该库本地库目录）→ 记录 doc_id
   │  ask：问题 → 答案 + 页级引用（P1 管理端试算；P3 Worker 通道）
   ▼
治理层（Host：状态机 / 待审发布 / 审计 / 成本 / 范围）
```

### 3.2 数据目录布局

```
<data 根>/
  knowledge/
    bases/<base_id>/
      library/                    # PageIndex 本地库目录（该库全部树索引）
      documents/<doc_id>/
        source.<ext>              # 原始文件（原样保存）
        normalized.pdf            # 规整稿（索引输入）
        transcript.md             # 音视频转写稿（可溯留档）
        extracted.md              # Office/扫描件中间文本（可溯留档）
```

`source_path` / `normalized.pdf` / `library/` 在 DB 中记录**相对路径**，便于整目录搬迁。

### 3.3 进程与并发模型

- **并发 = 1**：同一时间最多 1 个规整或索引作业在跑（与 MediaCrawler 同级约束）；后续可配 `KNOWLEDGE_JOB_CONCURRENCY`，默认与 v1 固定 1。
- **侧车按作业拉起**：非常驻进程；每次调用带超时，超时/取消杀进程；桥内错误映射为稳定错误码（§7.4）。
- **恢复**：Host 启动对账把 `running` 作业置 `failed(interrupted)`、资料置 `failed`，可重试（§5.4）。
- **Stub 模式**：`KNOWLEDGE_ENGINE_MODE=stub` 时 Node 侧用夹具替身，测试不依赖 Python。

## 4. 数据模型

新增 2 张表；迁移编号 **021**（`backend/migrations/021_knowledge_documents.sql`，`db.ts` 幂等同步）。旧库无需回填（新表初始为空）。

### 4.1 knowledge_documents — 非结构化资料

| 字段 | 类型 | 约束与默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键，非空 | `nid("kdoc")` 生成。 |
| `base_id` | TEXT | NOT NULL | 必须指向 `kind='unstructured'` 且 `status='active'` 的库；创建时校验，非法 400。 |
| `title` | TEXT | NOT NULL | 默认取文件名（去扩展名），可改。 |
| `filename` | TEXT | NOT NULL | 清洗后的原始文件名。 |
| `media_type` | TEXT | NOT NULL | 枚举 `pdf` / `pptx` / `image` / `audio` / `video`。 |
| `mime` | TEXT | 可空 | 浏览器给出的 MIME，未知为空。 |
| `size_bytes` | INTEGER | NOT NULL DEFAULT 0 | 原始文件字节数。 |
| `source_path` | TEXT | NOT NULL | 相对 `<data 根>` 的原始文件路径。 |
| `status` | TEXT | NOT NULL DEFAULT 'uploaded' | 枚举见 §5.1。 |
| `error` | TEXT | 可空 | 最近一次失败原因（人类可读）。 |
| `retry_count` | INTEGER | NOT NULL DEFAULT 0 | 累计重试次数。 |
| `artifacts` | TEXT | 可空 | JSON：`normalize`（模型、分段数、transcript/extracted/normalized 路径、tokens、成本估计、完成时间）与 `index`（engine、engine_version、doc_id、library 相对路径、页数、完成时间）。 |
| `created_by` | TEXT | 可空 | 上传人。 |
| `created_at` / `updated_at` | TEXT | NOT NULL | ISO 8601。 |
| `published_by` / `published_at` | TEXT | 可空 | 发布人与时间（审核后生效）。 |

**关键索引**：`knowledge_documents_base`（`base_id, status`）、`knowledge_documents_updated`（`updated_at DESC`）。

### 4.2 knowledge_document_jobs — 加工作业

| 字段 | 类型 | 约束与默认 | 说明 |
|---|---|---|---|
| `id` | TEXT | 主键，非空 | `nid("kdjob")` 生成。 |
| `document_id` | TEXT | NOT NULL | 指向 `knowledge_documents.id`。 |
| `kind` | TEXT | NOT NULL | 枚举 `normalize` / `index`。 |
| `status` | TEXT | NOT NULL | 枚举 `queued` / `running` / `done` / `failed` / `cancelled`。 |
| `progress_done` / `progress_total` | INTEGER | NOT NULL DEFAULT 0 | 真实进度分子/分母；`0/0` 表示该阶段无可细分进度（如索引构建），页面写明「无细分进度」。 |
| `detail` | TEXT | 可空 | JSON：阶段细节（分段序号、模型名、耗时、tokens、错误上下文）。 |
| `error` | TEXT | 可空 | 失败原因。 |
| `attempt` | INTEGER | NOT NULL DEFAULT 1 | 第几次尝试（重试 +1）。 |
| `created_by` | TEXT | 可空 | 触发人（系统作业写 actor）。 |
| `created_at` | TEXT | NOT NULL | 入队时间。 |
| `started_at` / `finished_at` | TEXT | 可空 | 执行/结束时间。 |

**关键索引**：`knowledge_document_jobs_doc`（`document_id, created_at DESC`）、`knowledge_document_jobs_status`（`status`）。

### 4.3 复用与映射

- `knowledge_bases.external_ref`：非结构化库创建/首次索引成功时写 `{"provider":"pageindex-local","version":"<pin>"}`（库级引擎绑定，单值）。
- 审计事件（沿用 `knowledge.*` 前缀）：`knowledge.document.upload|normalize|index|retry|cancel|publish|archive|delete|search`。
- 成本：规整与检索的模型用量经现有通道记 `cost_events`（归因到触发的管理员/系统作业；Agent 通道启用后归因到执行者）。
- 权限：v1 复用「发布即可见 + 品牌/范围」；`knowledge_grants` 不扩展到文档（页面标注，后续批次补文档级授权）。

## 5. 状态机与作业模型

### 5.1 文档状态

```
uploaded ──▶ normalizing ──▶ indexing ──▶ pending_review ──▶ published ──▶ archived
     │             │              │              │
     └────────────▶ failed ◀──────┘              └──（重新加工：重跑 normalize→index）
                   │  ▲
             retry │  │ cancel（仅 running 时）
                   ▼  │
               cancelled
```

枚举：`uploaded` / `normalizing` / `indexing` / `pending_review` / `published` / `archived` / `failed` / `cancelled`。

### 5.2 转移矩阵

| 动作 | 起点 → 终点 | 级 | 前置与副作用 | 审计 |
|---|---|---|---|---|
| 上传 | （无）→ `uploaded` | L2 | 库必须为非结构化且启用；落盘 → 建行 → 自动入队 normalize | `knowledge.document.upload` |
| 规整入队/执行 | `uploaded`/`failed`/`cancelled` → `normalizing` | L2 | 作业 `normalize`：`queued→running`；产出 normalized.pdf（+留档稿） | `knowledge.document.normalize` |
| 索引入队/执行 | `normalizing` → `indexing` | L2 | 规整完成自动衔接；作业 `index`：写入本地库目录并记录 doc_id | `knowledge.document.index` |
| 完成 → 待审 | `indexing` → `pending_review` | — | 系统动作；此前对员工与检索不可见 | — |
| 审批发布 | `pending_review` → `published` | **L3** | `ConfirmDialog` 事实清单（资料/库/页数/引用数）+ 持久回执；写 `published_by/at` | `knowledge.document.publish` |
| 重新加工 | `pending_review`/`published` → `normalizing` | L2 | 质量不满意时重跑（重建索引；已发布资料重跑后自动回到 `pending_review` 待重新审批） | `knowledge.document.normalize` |
| 归档 | `published` → `archived` | **L3** | 确认 + 回执；不再参与检索 | `knowledge.document.archive` |
| 删除 | 未发布任一状态 → （删行） | **L3** | 仅未发布可删；级联删作业、清理文件与该库索引中的该文档 | `knowledge.document.delete` |
| 取消 | `normalizing`/`indexing`（running）→ `cancelled` | L2 | 杀侧车进程；保留原文件与已产出中间物 | `knowledge.document.cancel` |
| 重试 | `failed`/`cancelled` → 对应阶段 | L2 | 从失败阶段重跑（索引失败不必重跑规整） | `knowledge.document.retry` |

### 5.3 作业与进度（诚实口径）

- `normalize`：音视频按分段计数（例：`3/8` 段）；扫描件/图片/PPTX 按页计数；文本型 PDF 为单步（`1/1`）。
- `index`：PageIndex 本地为同步构建，**无细分进度**；页面写「建索引中（无细分进度）」而不是伪造百分比；失败/成功以真实终态落库。
- 所有进度只来自真实完成的单位（段/页/阶段），不估算、不跳变。

### 5.4 失败、取消、重试、对账

- 超时：单作业总时限（默认 30 分钟，可配）与单步时限（规整单段 10 分钟）；超时转 `failed(timeout)`，可重试。
- 重试上限：默认 3 次；超过后页面提示「需人工排查」并给出错误原文。
- 取消：仅对 `running` 生效；`queued` 的作业直接标记 `cancelled` 并移出队列。
- 重启对账：启动时把 `running` 作业改 `failed`（`interrupted`），对应资料置 `failed`；`queued` 继续排队（单并发队列内存态，重启后允许人工重试——与现有 run-queue 的诚实口径一致）。
- 失败不删除原文：`source.<ext>` 永远保留，`normalized.pdf` 若已产出则保留复用。

## 6. 规整层详细设计

### 6.1 统一产出规范

- 产出**文本型 PDF**（`normalized.pdf`）作为唯一索引输入；文本层不可用即视为规整失败。
- 中间产物留档：音视频 `transcript.md`（全文转写 + 分段摘要），Office/扫描件 `extracted.md`（抽取文本）；供人工核对与管理端预览。
- 规整稿首页生成「来源页」：文件名、类型、时长/页数、加工模型、加工时间——让引用回答可回溯到来源（CONST-06）。
- 密钥扫描：产出文本过敏感词/密钥扫描（复用或新建规则集），命中项写入 `detail` 并在审批页显著提示；**不静默发布**。

### 6.2 PDF

- 文本型：检测文本层覆盖率（抽样页可抽取文本超阈值）→ 直通。
- 扫描件/低文本覆盖：逐页交视觉模型 OCR/理解，产出文本型 PDF（按页进度）。

### 6.3 音视频（全文转写稿 + 摘要）

- 分段：按 `KNOWLEDGE_MEDIA_SEGMENT_SECONDS`（默认 600s）切分；逐段调用多模态模型 → 该段转写 + 摘要。
- 合并：全文转写稿（`transcript.md`，含时间戳分段标题）+ 总摘要 → 文本型 PDF。
- 进度 = 已完成段数；单段失败重试后仍失败 → 作业 `failed`，保留已完成段落（重试从失败段继续）。
- 视频的视觉信息：默认以音轨转写为主；关键帧描述列为 P2 试点项（成本高，先按需开）。

### 6.4 PPTX / Office

- 逐页提取文本与备注 → `extracted.md` → 文本型 PDF；转换器选型在试点中锁定（候选：桥内 `python-pptx` 自绘，或 LibreOffice headless；本设计不锁定实现）。
- 图片型 PPTX（整页截图式）：走视觉模型逐页理解（同扫描件路径）。

## 7. 索引层（PageIndex 侧车）详细设计

### 7.1 位置与版本

- 目录：`backend/tools/pageindex-bridge/`（`bridge.py`、`requirements.txt`、`README.md`）。
- 依赖：Python ≥3.10；`pageindex` 版本 **pin**（试点后锁定确切版本号写入 requirements；升级按变更处理并记录）。
- 侧车是唯一接触 PageIndex SDK 的地方；Host 只认 §7.2 的 JSON 契约（便于升级与替换）。

### 7.2 命令与 JSON 契约（stdout 单行 JSON；日志走 stderr）

| 命令 | 参数 | 返回（ok=true） |
|---|---|---|
| `ping` | — | `{"ok":true,"python":"3.12.x","pageindex":"<版本>"}` |
| `index` | `--input <normalized.pdf>` `--library <dir>` `--index-model <m>` | `{"ok":true,"doc_id":"pi-…","pages":12,"elapsed_ms":…,"usage":{…}}` |
| `ask` | `--library <dir>` `--question <q>` `--chat-model <m>` `[--doc-id <id>]…` `[--citations]` | `{"ok":true,"answer":"…","citations":[{"document":"…","doc_id":"…","page":12}],"usage":{…}}` |

- `ask` 的 `--doc-id` 可重复；缺省 = 对该库本地库目录全量检索（SDK `doc_id: string | List[string]`，省略则整库）。
- 引用：`citations=True` + `resolve_citations()`，本地模式为**页级**（块级为 Cloud-only，不用）。

### 7.3 模型配置（三道分开，均可配）

| 用途 | 配置项 | 建议档位 |
|---|---|---|
| 建树索引 | `KNOWLEDGE_INDEX_MODEL` | 便宜档（索引阶段对质量影响小） |
| 检索问答 | `KNOWLEDGE_CHAT_MODEL` | 能力档（检索质量随模型能力上升） |
| 音视频/扫描件规整 | `KNOWLEDGE_MEDIA_MODEL` | 多模态档（需支持音/视频或图像输入） |

Provider 复用本仓既有模型通道（OpenAI 兼容端点）；桥以环境变量接收 base_url / key，不落盘。

### 7.4 错误映射（桥 → Host 稳定错误码）

| 场景 | 错误码 |
|---|---|
| python / pageindex 未安装、ping 失败 | `knowledge_index_unavailable`（页面灰置上传并如实说明） |
| index 失败（含非文本型 PDF） | `knowledge_index_failed` |
| ask 失败 | `knowledge_ask_failed` |
| 超时/被杀 | `knowledge_index_timeout` / `knowledge_job_cancelled` |

### 7.5 本地库目录与隔离

- 每库一目录 `bases/<base_id>/library/`；桥以工作目录/配置指向该目录（SDK 本地存储目录的具体配置方式以试点实测为准，桥内封装）。
- 库级隔离 = 目录隔离：试算与 P3 检索都只加载目标库的本地库目录，天然不跨库串数据。

### 7.6 Stub 模式

- `KNOWLEDGE_ENGINE_MODE=stub`：Host 侧替身按契约返回夹具（固定 doc_id/answer/citations），用于全部单测与 e2e；真机质量验证走 §12.3 试点。

## 8. 检索详细设计（P1：管理端试算）

### 8.1 语义

- 一次检索 = 对目标库的 `chat(question, doc_id=[…]或全库, citations=True)`，**直接返回答案**；引用解析为编号列表（文档名 + 页码）。
- 未发布资料**默认不参与**（审核后生效）；审批前质量核对场景：`include_pending=true` 且 `doc_ids` 只含该资料（管理员 L1 只读动作）。
- 附加 `instructions`（可选）：本轮只用于范围说明（如「只依据提供的文档回答；找不到就说找不到」），不写库。

### 8.2 接口

`POST /api/admin/knowledge/search`

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 是 | 问题文本。 |
| `base_id` | 是 | 目标非结构化库；必须 active。 |
| `doc_ids` | 否 | 限定资料子集（string[]）；缺省 = 全库已发布。 |
| `include_pending` | 否 | 仅审批场景使用（L1；服务端只允许单文档）。 |

返回：`{answer, citations:[{document, doc_id, page}], usage:{tokens, elapsed_ms}}`；引擎不可用返回 503 `knowledge_index_unavailable`（页面如实提示，不伪造答案）。

### 8.3 成本与审计

- `usage` 归一后记 `cost_events`；审计 `knowledge.search`（含 base_id、doc_ids 范围、耗时、是否 include_pending）。
- 管理端试算面板展示本次耗时与 token（诚实呈现成本）。

## 9. 管理端交互设计

### 9.1 入库视图（升级现有 Ingest）

- **上传**：解禁并真实可用——选择非结构化库 + 拖拽/选择文件（接受 pdf/pptx/图片/音频/视频）；上传后立刻出现在资料列表（`uploaded`）。
- **资料列表**：标题、类型、状态、真实进度（`3/8 段` 或「建索引中（无细分进度）」）、大小、更新时间；行内动作：详情 / 重试 / 取消 / 删除（按状态显示，权限分级）。
- **详情**：原文件与规整稿预览、转写稿展开、作业历史（attempt × 阶段 × 终态）、错误原文。
- **引擎健康**：`GET /api/admin/knowledge/index-health`；不可用时上传区灰置并写明原因（缺 Python/缺包），不伪造。
- 旧的 raw/extract 区块保留（失败会话留档检索），与新上传区分区展示。

### 9.2 库详情（非结构化库）

- 资料列表替代条目表；库头标注「非结构化：解析与检索由 PageIndex 本地承担」。
- **试算面板**：选择范围（全库 / 指定资料）→ 提问 → 渲染答案 + 引用列表（页码锚点）；`include_pending` 只在单资料详情中出现（标注「仅审核用」）。

### 9.3 待处置（review）

- 新增「待审资料」区块：库/标题/页数/规整模型/密钥扫描警示；动作：发布（L3）/重新加工/删除。

### 9.4 DOM 契约与不变量（e2e 依据）

- 新契约（沿用 `data-admin-kb-*` 前缀）：`data-admin-kb-upload`、`data-admin-kb-doc`（含 `data-admin-kb-doc-status`）、`data-admin-kb-doc-progress`、`data-admin-kb-job`、`data-admin-kb-doc-retry|cancel|delete|publish`、`data-admin-kb-trial-form|answer|citation`。
- 不变量：状态不靠颜色（文字+图标）；每视口 0–1 实底 CTA（上传或发布按状态唯一）；L3 走 `ConfirmDialog` + 持久回执；未实现处显式标注（CONST-10）。

## 10. 接口清单（P1 新增）

| 接口 | 动作 | 级 |
|---|---|---|
| `POST /api/admin/knowledge/documents`（multipart） | 上传资料并入队 | L2 |
| `GET /api/admin/knowledge/documents?base=&status=` | 资料列表 | L1 |
| `GET /api/admin/knowledge/documents/:id` | 详情 + 作业历史 | L1 |
| `POST /api/admin/knowledge/documents/:id/retry` | 重试（从失败阶段） | L2 |
| `POST /api/admin/knowledge/documents/:id/cancel` | 取消 running 作业 | L2 |
| `POST /api/admin/knowledge/documents/:id/reprocess` | 重新加工（待审/已发布） | L2 |
| `POST /api/admin/knowledge/documents/:id/publish` | 审批发布 | L3 |
| `POST /api/admin/knowledge/documents/:id/archive` | 归档 | L3 |
| `DELETE /api/admin/knowledge/documents/:id` | 删除（仅未发布） | L3 |
| `POST /api/admin/knowledge/search` | 管理端试算 | L1 |
| `GET /api/admin/knowledge/index-health` | 侧车健康 | L1 |

## 11. 配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `KNOWLEDGE_ENGINE_MODE` | `real` | `stub` 用于测试（无 Python 依赖）。 |
| `KNOWLEDGE_PAGEINDEX_PYTHON` | `python` | 侧车解释器路径。 |
| `KNOWLEDGE_INDEX_MODEL` / `KNOWLEDGE_CHAT_MODEL` / `KNOWLEDGE_MEDIA_MODEL` | 试点后定 | 三档模型（§7.3）。 |
| `KNOWLEDGE_DOCS_DIR` | `<data>/knowledge` | 资料根目录。 |
| `KNOWLEDGE_JOB_CONCURRENCY` | `1` | 加工并发（v1 固定 1）。 |
| `KNOWLEDGE_JOB_TIMEOUT_MINUTES` | `30` | 单作业总时限。 |
| `KNOWLEDGE_MEDIA_SEGMENT_SECONDS` | `600` | 音视频分段长度。 |
| `KNOWLEDGE_DOC_MAX_BYTES` | `536870912`（512 MiB） | 单文件上限；超限 413 并如实提示。 |

## 12. 测试与验收

### 12.1 单测与契约（stub 引擎）

- 状态机：合法/非法转移、并发 1 保护、重启对账、取消/重试幂等。
- 权限与闸门：上传仅非结构化启用库；发布 L3（确认+回执+审计）；未发布不参与库级试算。
- 接口契约：§10 全量端点（错误码矩阵，含 503 引擎不可用）。
- 审计与成本：事件清单齐全、cost_events 归因正确。

### 12.2 e2e（stub 引擎，Playwright）

上传（fixture pdf）→ 资料列表出现 → 进度推进 → 待审 → 发布（L3 回执）→ 试算命中并渲染引用；失败路径：fixture 失败 → 重试 → 成功；取消路径有真实终态。

### 12.3 真机试点（记录留档）

| 样例 | 验证点 |
|---|---|
| 中文复杂版式 PDF | 版面与文本层质量、回答与引用准确度 |
| 扫描件 PDF（图片） | 视觉 OCR 质量与成本 |
| PPTX（含备注页） | 转换质量 |
| 音频（10 分钟）+ 视频（5 分钟） | 转写质量、分段进度、成本实测 |

试点结论（质量/成本/耗时）填回本文件附录后，才开启 P3 Worker 通道。

### 12.4 门禁

`npm run typecheck`、后端知识与新端点测试、前端 `tsc`/`build`、e2e 知识套件（含新增用例）、发布门禁（`.github/workflows/release-gate.yml`）。

## 13. 风险与后续议题

| 风险/议题 | 处置 |
|---|---|
| PageIndex 处 Alpha（0.2.x） | pin 版本；唯一接触点=侧车契约；升级=变更记录+试点 |
| 中文版面 / 扫描 OCR 质量 | §12.3 试点；不合格则换规整模型或预处理策略 |
| 音视频成本与时长 | 分段 + 成本展示；`KNOWLEDGE_MEDIA_SEGMENT_SECONDS` 可调 |
| SDK 本地库目录配置方式未实测 | 桥内封装（§7.5）；试点首日确认 |
| 大文件磁盘占用 | v1 展示用量；清理/留存策略列为后续（对齐 retention 机制） |
| 多文档 chat 上限（doc 数/上下文/成本） | 试点测库级提问；必要时引入「先选子集」交互 |
| 文档级 grants、员工面、Worker 通道 | 明确列 P3/后续，不在 P1 宣称 |
| 关键帧视觉理解（视频画面） | P2 试点项，默认关闭 |

外部链接：PageIndex 仓库 <https://github.com/VectifyAI/PageIndex>；SDK 文档 <https://docs.pageindex.ai/sdk>（chat/<https://docs.pageindex.ai/sdk/chat>、documents/<https://docs.pageindex.ai/sdk/documents>）。

## 14. 落档清单（确认本文档后执行）

1. **ADR 修订**（`docs/DECISIONS.md`，在 ADR-2026-10-01（三）下追加修订）：非结构化引擎由 WeKnora 改为 **PageIndex 本地 + 多模态规整层**；补记 2026-10-02 四条用户决策；WeKnora 引用降为历史记录。
2. **旧 spec 指针**：`specs/2026-09-26-knowledge-base-skill-agent-design.md` §4.3.1 / §12 中 WeKnora 相关表述改为指向本文件。
3. **实施登记**：新增 `KNOWLEDGE-02 非结构化层（PageIndex 本地 + 多模态规整层）` 行（status `not_started`，implementation_assets 指向本设计与 P1 计划）。
4. **实施计划**：`plans/2026-10-02-knowledge-unstructured-pageindex-implementation.md`（P1 分步）。
5. **数据字典**：`knowledge_documents` / `knowledge_document_jobs` 在 **P1 实施落地后**按实际 schema 补条目（设计期不入字典，避免以文档冒充实现）。
