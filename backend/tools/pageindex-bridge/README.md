# pageindex-bridge（知识非结构化层侧车）

Node 与 PageIndex 的**唯一接触点**。Node 侧通过 `backend/src/knowledge-bridge.ts` 以
stdout 单行 JSON 契约调用本脚本；侧车升级/替换不影响 Host。

- 契约：`docs/superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md` §7.2
- 命令：`ping` / `index` / `ask` / `render` / `make-pdf` / `remove`
- 运行：`python bridge.py <cmd> [--args…]`（解释器路径可用 `KNOWLEDGE_PAGEINDEX_PYTHON` 覆盖）
- 依赖：`pip install -r requirements.txt`（Python ≥ 3.10）
- 测试：后端与 e2e 默认走 `KNOWLEDGE_ENGINE_MODE=stub`（Node 内夹具），**不依赖本目录**；
  本目录只在真实模式（试点与生产）使用。

## 试点待办（首日实测后固定，写回本节）

1. **本地库目录机制**：当前以 `PAGEINDEX_HOME=<library>` 指向每库目录；需实测 SDK 本地
   存储是否遵循该变量（或改用其参数/工作目录），并把结论固定到 `bridge.py`。
2. **pageindex 版本**：`requirements.txt` 的 pin 与 `ping` 返回值对齐；升级按变更处理。
3. **模型配置**：`KNOWLEDGE_INDEX_MODEL` / `KNOWLEDGE_CHAT_MODEL` / `KNOWLEDGE_MEDIA_MODEL`
   与 provider（OpenAI 兼容端点）实测；记录每查成本。
4. **Windows 依赖**：`pypdfium2` / `reportlab` 在 Windows 的安装验证。
