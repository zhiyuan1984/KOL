# Codex app-server 协议 schema

**Codex harness = 本协议。** 业务 Skill 的生产执行走 `codex app-server`（thread / turn / Skill / MCP），不是 Host TypeScript。

本目录由本机 `codex app-server generate-json-schema --out docs/codex` 生成（云 VM 已跑过）。

实现见 `backend/src/worker/codex.ts` 与 `backend/src/worker/runner.ts`。工具节点见 `backend/mcp/`（MCP 带 `jsonrpc:2.0`；app-server 省略）。

- 线格式：换行 JSON，**不含** `jsonrpc:2.0`
- `initialize` → `initialized`
- `account/read`（`refreshToken: true`）；若无账号且环境有 `OPENAI_API_KEY` / `CODEX_API_KEY`，再 `account/login/start` `{type:apiKey}`
- `skills/extraRoots/set`（`extraRoots`）
- `skills/config/write`
- `thread/start` 或 `thread/resume`
- `turn/start`（text + `{type:skill,name,path}`）
- 等 `turn/completed`

官方说明：https://learn.chatgpt.com/docs/app-server.md
