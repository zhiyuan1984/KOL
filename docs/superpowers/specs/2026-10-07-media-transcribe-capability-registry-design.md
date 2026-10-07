# 非结构化两补齐：音视频转写流水线 + 技能/模型能力注册表

> 日期：2026-10-07
> 状态：提案（待确认决策点见 §5；确认后转实施计划）
> 范围：① 补规整层音视频（及图片）转写缺口；② 新增技能/模型能力注册表（索引而非仓库）
> 关联：[2026-10-02-knowledge-unstructured-pageindex-design.md](2026-10-02-knowledge-unstructured-pageindex-design.md)（非结构化层设计）、`backend/src/host/knowledge-documents.ts`（规整/索引实现）、`backend/src/tasks/registry.ts`（TaskDefinition 权威目录）、`backend/src/routers/skill-runtime.ts`（Agent—Skill—Connector—Tool 装配）、`backend/src/tasks/agent-routing.ts`（路由）

## 0. 背景

10-02 非结构化设计稿规定了「规整层 + 索引层 + 原始留档」三层架构，PageIndex 只吃文本型 PDF，多模态内容由规整层先转成文本。实现现状：

- ✅ 文本型 PDF 直通、扫描件逐页 OCR（`scanned-ocr`，真实页进度）已实现
- ❌ `normalizeStage` 无 `media_type` 分发：`audio` / `video` 上传后会在 `pdfHasTextLayer` → `render` 链路失败；`image` 单图同样无独立路径（pypdfium2 无法渲染 PNG）
- ❌ 技能与模型能力只有手写配置（`KNOWLEDGE_*_MODEL` 三档）与运行时目录（TaskDefinition），没有统一的「能力画像」登记处，调度层无法按能力匹配

本提案一次补齐两块，互不依赖，可独立排期。

## 1. Part A：音视频（及图片）转写流水线

### 1.1 设计原则

- 复用现有作业模型：`normalize` 作业的真实进度、分段续跑、取消/重试、成本审计口径全部沿用，不新增状态
- 复用现有下游：转写产物 → `transcript.md` 留档 → `make-pdf` 桥命令 → `normalized.pdf` → 现有 `indexStage` 不变
- 与设计稿 §6.3 对齐：音视频产出 = 全文转写稿 + 摘要；视频默认以音轨转写为主，关键帧视觉理解为 P2 开关（默认关）

### 1.2 normalizeStage 分发（唯一改动入口）

```
normalizeStage(doc):
stub 模式 → 现状不变
media_type = pdf:
有文本层 → text-passthrough（现状）
无文本层 → scanned-ocr（现状）
media_type = image:
单图直调 ocrImageWithVision → extracted.md → make-pdf（= scanned-ocr 的单页特例）
media_type = audio / video:
transcribeMedia(doc, jobId, signal) # 新增，见 1.3
media_type = pptx:
本次不动（转换器选型在原设计稿中即为"试点后锁定"，保持现状：走失败路径并如实报错）
```

### 1.3 transcribeMedia 流程

1. **切分**：ffmpeg 按 `KNOWLEDGE_MEDIA_SEGMENT_SECONDS`（默认 600s，原设计稿已定义）切段，输出 wav/opus 临时分段；切分失败 → 作业 `failed`（错误原文保留）
2. **逐段转写**：每段调用多模态模型（`KNOWLEDGE_MEDIA_MODEL`，即 `mediaModel()`，不新增配置项），一次调用返回该段转写文本 + 该段一句话摘要；prompt 要求"只转写不总结、不编造，静音段标注"
3. **合并**：`transcript.md`（全文转写，`## [00:10:00–00:20:00]` 时间戳分段标题）+ 文首总摘要（由各段摘要再拼一次摘要调用，或直接拼接——推荐后者，省一次调用）→ `extracted.md` 复用 → `make-pdf` → `normalized.pdf`（规整稿首页来源页沿用现有格式：文件名/类型/时长/模型/时间）
4. **进度**：`updateJobProgress(jobId, 已完成段数, 总段数, { mode: "media-transcribe"})`，真实段数，不估算
5. **断点续跑**：已完成段落的转写文本落临时文件（`segments/seg-N.json`），重试时跳过已完成段，只跑剩余段——与设计稿 §6.3"重试从失败段继续"对齐
6. **成本**：每段 tokens 累加，`recordCostEvent({ source: "knowledge_normalize", model: mediaModel(),...})`，与 OCR 路径同口径
7. **取消**：`signal.aborted` 检查放在每段之间，复用现有取消语义

### 1.4 视频视觉（P2，默认关闭）

- 开关 `KNOWLEDGE_MEDIA_KEYFRAMES=false`；开启后每段抽 1 关键帧交视觉模型描述，描述文本并入该段转写（标注）
- 成本高，先按需开；P1 只做开关与链路占位，不默认启用

### 1.5 测试与验收

- stub 引擎扩展：`KNOWLEDGE_STUB_NORMALIZE_MS` 现状复用；新增测试标记 `STUB_FAIL_TRANSCRIBE_SEGMENT=N`（第 N 段失败）验证断点续跑
- 单测：分发矩阵（5 种 media_type 走对路径）、段进度真实、取消幂等、重试跳过已完成段
- 真机试点：10 分钟音频 + 5 分钟视频各一（原设计稿 §12.3 样例），记录转写质量/成本/耗时，回填本文件附录

## 2. Part B：技能/模型能力注册表

### 2.1 定位（一句话）

**索引而非仓库**：不存外部 skill 的源码、不存模型权重，只登记"它能干什么、怎么调、用得怎么样"的能力画像，供调度层做任务→Skill→模型的匹配。这是知识五类承载中"经验"层的登记处，也是调度系统的输入。

### 2.2 数据模型（新增 1 张表，不动 TaskDefinition）

`capability_registry`：

| 字段 | 说明 |
|---|---|
| `id` | `nid("cap")` |
| `kind` | `skill` / `model` / `connector`（预留 connector，P1 只用前两种） |
| `ref_id` | skill → TaskDefinition.id 或外部 skill 标识；model → 模型名（如 `gpt-5.6-sol`） |
| `origin` | `bundled` / `external` / `manual`（外部 skill 记来源 URL/提供方） |
| `capability` | JSON：能力描述（人类可读）、适用任务类型、输入输出 schema 摘要 |
| `constraints` | JSON：风险分级（R1/R2/R3）、速率/成本约束、数据驻留要求 |
| `version` / `version_pinned` | 外部 skill/model 的版本 pin；升级按变更处理 |
| `stats` | JSON：调用次数、成功率、P50 耗时、平均成本（运行自动写回，见 2.4） |
| `notes` | 人工评分/备注（P1 只留字段，评分 UI 为 P2） |
| `status` | `active` / `deprecated` |
| `created_by` / `updated_at` | 溯源 |

不改 TaskDefinition 的理由：它是运行时契约（input_schema、context、actions 参与执行校验），能力画像是调度参考；两者通过 `ref_id` 关联，关注点分离，外部 skill（不在 TaskDefinition 里）也能登记。

### 2.3 登记来源

1. **管理端手动登记**（P1）：技能目录页新增"能力登记"入口，L2 动作；外部 skill 填来源与契约摘要，模型填能力画像
2. **运行自动写回**（P1 只做计数器）：skill/model 每次调用后更新 `stats`（调用次数、成功/失败、耗时、成本）——只写聚合数字，不记业务内容
3. **知识飞轮**（P2）：人工评分、"这次用得好/不好"的经验沉淀进 notes，调度排序加权

### 2.4 调度层对接点（只读，不改路由决策权）

- `agent-routing.ts` 的 `availableAgentRoutes` 在组装路由摘要时，可选附带 `capability_registry` 中的成功率/成本标签（展示用，不改变过滤逻辑）
- 新增 `resolveCapability(kind, ref_id)` 只读查询，供后续调度器/改写器按能力画像选模型（如"转写任务 → mediaModel 画像最好的"），P1 先提供查询接口，不自动切换模型（自动切换为 P2，需另行审宪）

### 2.5 模型能力画像初始值（P1 手动登记三条）

| 模型（ref_id） | 画像摘要 |
|---|---|
| `KNOWLEDGE_INDEX_MODEL` 当前值 | 建树索引：便宜档，质量要求低 |
| `KNOWLEDGE_CHAT_MODEL` 当前值 | 检索问答：能力档，质量随模型能力上升 |
| `KNOWLEDGE_MEDIA_MODEL` 当前值 | 多模态：需支持音/视频或图像输入 |

画像字段示例：`{ roles: ["检索问答", "多模态规整"], strengths: ["中文问答", "音频转写"], cost_tier: "high" }`——P1 先以人工填写的 JSON 为准，stats 由运行自动补。

**合并规则**：同一模型承担多档时只存一条画像（`UNIQUE(kind, ref_id)`），`roles` 数组列出全部角色，`cost_tier` 取最高档。默认配置下 `KNOWLEDGE_CHAT_MODEL` 与 `KNOWLEDGE_MEDIA_MODEL` 同为 `gpt-5.6-sol`，因此懒加载只产生 2 行（`gpt-5.6-luna` 建树索引 / `gpt-5.6-sol` 检索问答+多模态规整），这是预期行为不是缺失。

### 2.6 测试与验收

- 单测：登记/查询/stats 写回的 CRUD；`ref_id` 指向不存在的 skill 时查询返回空而不抛错（外部 skill 先登记后接入是合法顺序）
- e2e：管理端登记一条外部 skill → 路由摘要出现能力标签 → 调用后 stats +1
- 门禁：`npm run typecheck`、后端单测、发布门禁（沿用现有）

## 3. 实施分期

- **Phase 1**：Part A（A1–A3、A5）+ Part B（B2、B3 来源①②、B4 查询接口、B5 初始三条）
- **Phase 2**：A4（关键帧开关链路）、B3 来源③（人工评分 UI）、B4 自动切换模型（需审宪）

## 4. 风险

| 风险 | 处置 |
|---|---|
| ffmpeg 为新增系统依赖 | Dockerfile 与部署说明同步；缺失时转写路径如实 503（`knowledge_index_unavailable` 同族错误码），不静默失败 |
| 长音视频转写成本 | 分段 + 成本展示（现有 `cost_events` 口径）；单文件上限沿用 `KNOWLEDGE_DOC_MAX_BYTES` 512MiB |
| stats 写回与业务数据隔离 | 只记聚合数字（次数/成功率/耗时/成本），不记 prompt 与业务内容 |
| 外部 skill 契约漂移 | `version_pinned` + 状态 `deprecated` 手动标记；P1 不做自动探活 |

## 5. 待确认决策点（逐项否决）

| # | 决策 | 推荐 |
|---|---|---|
| D1 | 转写模型复用 `KNOWLEDGE_MEDIA_MODEL`，不新增配置项 | ✅ 推荐 |
| D2 | 视频默认只转写音轨，关键帧视觉为 P2 开关（默认关） | ✅ 推荐（与 10-02 设计稿一致） |
| D3 | 切分走本地 ffmpeg，而非整文件丢给模型 | ✅ 推荐（可断点续跑、可重试；整文件上传不可靠） |
| D4 | 能力注册表独立新表 `capability_registry`，不动 TaskDefinition | ✅ 推荐（运行时契约与调度参考分离） |
| D5 | 模型能力画像与 skill 进同一张表（`kind` 区分） | ✅ 推荐（调度器统一查询口） |
| D6 | P1 的 stats 只做自动计数器（次数/成功率/耗时/成本），人工评分为 P2 | ✅ 推荐 |
| D7 | pptx 本次不动（保持转换器选型待试点） | ✅ 推荐（不扩大范围） |
