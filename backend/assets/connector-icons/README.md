# 内置连接器图标

| 文件 | 连接器 | 样式 |
|---|---|---|
| `claw.png` | MediaCrawler MCP（爬虫） | 底色 `#0f7f96`（类别色 crawl），白色蜘蛛图形 |
| `starrykol.png` | Starry KOL MCP（红人库） | 底色 `#4f5bd5`（类别色 library），白色四角星图形 |

图形来源：Material Design Icons（Apache-2.0），经 jsDelivr 下载后栅格化为 512×512 PNG（白字 + 类别色底）：

- https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/spider.svg
- https://cdn.jsdelivr.net/npm/@mdi/svg@7.4.47/svg/star-four-points.svg

用法：`GET /api/admin/connectors/:id/icon` 在 `connectors.icon_ref` 为空时回退到这里的默认图标；
管理端上传的图标始终优先。`connectorPublic.icon_url` 在存在上传图标或内置默认图标时为真。
