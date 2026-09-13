# MCP 线上接入

## 地址配置

当前穿透地址（natapp，进程需保持运行）：

```text
http://s636695a.natappfree.cc/mcp
```

探活（无需鉴权）：

```text
GET http://s636695a.natappfree.cc/health
```

线上 Agent 请求 `/mcp` 时带上 `.env` 里的 `MEDIACRAWLER_MCP_TOKEN`：

```text
Authorization: Bearer <MEDIACRAWLER_MCP_TOKEN>
```

本机启动：

```powershell
uv run python mcp_server.py --tunnel
```

`.env` 需要：

```text
NATAPP_AUTHTOKEN=          # natapp 隧道 token，本地端口 8000
MEDIACRAWLER_MCP_TOKEN=    # 为空时 --tunnel 会自动生成
```

免费隧道是 HTTP，重启后域名可能变化，以启动日志里的 `public_url` 为准。

---

## 功能

同一时间只能跑一个任务。`start_crawl` 立刻返回 `task_id`，任务成功后会自动把该任务的创作者数据上传到 `KOL_INGESTION_URL`。


| 工具                | 功能                                                         |
| ------------------- | ------------------------------------------------------------ |
| `start_crawl`       | 启动采集。平台：YouTube、Instagram、Facebook。模式：`search`（必填 `keywords`）/ `detail`（`specified_ids`）/ `creator`（`creator_ids`） |
| `get_crawl_status`  | 查看 `task_id`、运行状态、平台、上传错误                     |
| `get_crawl_logs`    | 查看最近采集/上传日志                                        |
| `stop_crawl`        | 停止采集和浏览器                                             |
| `get_creators`      | 分页读取标准化创作者（`platform`、`platform_creator_id`、`nickname`、`followers`、最近 10 条 `views`） |
| `list_result_files` | 列出创作者结果文件                                           |
| `upload_creators`   | 按 `task_id` 重试入库                                        |
| `clear_history`     | 清空历史数据，必须 `confirm=true`                            |


建议流程：`start_crawl` → 轮询 `get_crawl_status` 直到 `idle` 或 `error` → `get_creators` 看结果，失败再用 `upload_creators`。
