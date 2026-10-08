# 音视频资料 v2 被误识别为 PDF：修复与验证

## 范围与审查

需求：修复 MP4 资料创建 v2 后报 `could not read PDF: EOF marker not found`，使新版本保留实际媒体类型，错误规整稿可正确恢复。

主责角色：后端专家负责版本文件与处理链路；前端专家负责真实媒体类型文案；测试经理负责基线对照及回归证据。

适用条款：CONST-04、CONST-06、CONST-08、CONST-10；TECH-BE-01、TECH-BE-03、TECH-BE-04、TECH-BE-08、TECH-TEST-01~04；DESIGN §1 不变量 3/4、§4.2。

结论：符合。本次不更改审批、权限、发布、生效版本规则，不把加工完成伪装成正式发布，不改动原始来源内容。界面只修正文案与既有上传格式的选择范围，不变更视觉 token、布局或路由。

## 根因证据

- v1 `kdoc_54ec53fd5fd7` 实际类型为 `video` / `video/mp4`，已完成 `media-transcribe` 和 PageIndex 索引，状态为 `pending_review`。
- v2 `kdoc_5a10907d-09e7-4637-b7f3-3bbd4eb52458` 的 lineage 指向该 v1，版本号为 2。
- `createDocumentRevision()` 把 `source.pdf`、`media_type='pdf'`、`mime='application/pdf'` 写死，却复制原始 MP4 字节。
- v1 的 `source.mp4`、v2 的 `source.pdf` 和 v2 的 `normalized.pdf` SHA-256 完全一致：`4121e5c738cecb351c782eb56dc9abc3c14b75a8752f0e819aa19dd8beaa30ff`。
- `file` 检测 v2 的两个 `.pdf` 文件均为 MP4 容器；v1 的真实 `normalized.pdf` 为 1 页 PDF。
- 旧 PDF 文本检测在 `pdftotext` 失败时用括号模式粗检，未先检查 PDF 魔数，使 MP4 被直接复制成规整稿。
- 重试原来仅判断规整稿是否存在，错误 PDF 仍会从索引阶段重复失败。

## 修复资产

1. `backend/src/knowledge/publication.ts`：版本原件继承文件扩展名、媒体类型与 MIME；草稿替换与首次上传共享格式、魔数及文件大小校验，并更新媒体元数据。
2. `backend/src/host/knowledge-documents.ts`：统一媒体校验；PDF 文本检测先检查魔数；真实索引入口校验规整稿 PDF 头和 EOF；无效规整稿的重试回到规整阶段；原件响应返回实际 MIME。
3. `backend/src/routers/knowledge.ts`：草稿替换的缺文件错误改为通用资料原件文案。
4. `frontend/src/admin/knowledge/DocumentRail.tsx`：按真实媒体类型显示原件信息，草稿替换选择器允许后端已支持的 PDF、图片、音视频格式。
5. `backend/tests/knowledge-publication.test.ts`：增加版本媒体继承、媒体替换与大小/版本保护、错误规整稿恢复和假 PDF 防误识别测试。

## 验证状态

- 修复前红灯：MP4、MP3、PNG 的版本继承用例全部复现 PDF 硬编码问题；PDF 用例通过。
- 修复后后端 `tsc --noEmit` 和前端 `tsc --noEmit` 均通过。
- 首次两组完整回归：36 个用例中 28 个通过，8 个失败；失败包含审批范围/权限的既有用例及一个跨用例时序异常，尚不能将整套回归报告为通过。
- 未修改的 `eac63430` 基线对照和独立目标回归正在验证；实际结果须追加到本记录。
- PostgreSQL 回归使用模板复制的隔离测试库，不以生产库做测试数据写入。

## 当前 v2 恢复方案

只针对上述失败 v2：校验父子版本、失败状态、无审批冻结、v1/v2 字节哈希相同且为 MP4；备份数据库行和错误文件；保留原文件与旧作业历史；纠正元数据与路径，清除错误规整记录并入队常规 normalize 作业；通过服务启动对账恢复正常转写和索引，记录运维修复与重试审计。不得直接写成 `pending_review` 或 `published`，不得修改 v1。

## 边界

PDF 头和 EOF 校验是结构性前置保护，不代替完整 PDF 解析。回归夹具与真实服务验证分别报告。原件媒体 MIME 与引用页面的进一步跨媒体呈现不在本次故障修复范围。

## 回归结果补记（2026-10-09 02:47）

- 未修改的 `eac63430` 基线：29 个用例，23 通过、6 失败。两个版本审批用例被既有“知识范围先核对”规则拦截；四个资料测试涉及检索、原件访问和引擎健康接口权限/测试口径。没有绕过这些规则或把失败改成通过。
- 修复后的独立专项回归：14 个用例全部通过，22 个不相关用例未执行，包括 7 个新增用例与 7 个现有上传、规整、媒体分段、索引重试、取消恢复用例。
- 第一次完整修复回归另见一个 `runtime_agent_not_usable` 和一个跨用例“资料不存在”的非稳定失败；后者在独立媒体回归中通过。整套全量回归未通过，不能报告为完整发布门禁通过。
- 本次发布范围仅限媒体版本类型、文件原件、规整/重试保护；完整审批/权限测试差距另行跟踪，不扩大本修复范围。
- 生产端最终恢复以真实 v2 的作业记录、转写文件和可解析 PDF/真实 PageIndex 产物为准，不以 stub 测试替代。
