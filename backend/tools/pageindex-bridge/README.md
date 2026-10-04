# pageindex-bridge（知识非结构化层侧车）

Node 与 PageIndex 的**唯一接触点**。Node 侧通过 `backend/src/knowledge-bridge.ts` 以
stdout 单行 JSON 契约调用本脚本；侧车升级/替换不影响 Host。

- 契约：`docs/superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md` §7.2
- 命令：`ping` / `index` / `ask` / `render` / `make-pdf` / `remove`
- 运行：`python bridge.py <cmd> [--args…]`（解释器路径可用 `KNOWLEDGE_PAGEINDEX_PYTHON` 覆盖）
- 依赖：`pip install -r requirements.txt`（Python ≥ 3.10）
- 测试：后端与 e2e 默认走 `KNOWLEDGE_ENGINE_MODE=stub`（Node 内夹具），**不依赖本目录**；
  本目录只在真实模式（试点与生产）使用。

## 接口验证（2026-10-04）

已验证 0.2.21 的 `index_model` / `chat_model` / `storage_path`、`chat(citations=True)` 与 `resolve_citations(answer, doc_id=...)`。0.2.10 不支持原桥接使用的调用接口。每库使用显式本地目录，不依赖未验证的环境变量。真实合成两页 PDF 索引与问答返回了正确的第二页引用。

`python -m unittest test_bridge.py` 验证存储隔离及 OCR 重排到原件页码的映射。

## 部署核对

1. **本地库目录**：显式 `mode="local", storage_path=<library>`；部署时验证目录写权限。
2. **pageindex 版本**：`requirements.txt` 的 pin 与 `ping` 返回值对齐；升级按变更处理。
3. **模型配置**：`KNOWLEDGE_INDEX_MODEL` / `KNOWLEDGE_CHAT_MODEL` / `KNOWLEDGE_MEDIA_MODEL`
   与 provider（OpenAI 兼容端点）实测；记录每查成本。
4. **Windows 依赖**：`pypdfium2` / `reportlab` 在 Windows 的安装验证。
