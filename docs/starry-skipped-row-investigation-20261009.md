# Outdoor Boys 入库跳过：真实原因

调查时间：2026-10-09 11:17–11:21（北京时间）。

## 最新生产审计

审计 ID：`30279`；时间：11:16:38；操作者：`sriphy`；候选：`UCfpCQ89W9wjkHc8J_6eTbBg`；工具：`importKolProfilesFromCrawler`。

本次 `starry_response` 已正常保存，证明前一轮实际发布目录的诊断修复已加载。

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "totalCount": 1,
    "createdCount": 0,
    "updatedCount": 0,
    "failedCount": 0,
    "failures": [],
    "skippedCount": 1,
    "skipped": [{
      "rowNo": 2,
      "kolUid": null,
      "kolName": "Outdoor Boys",
      "reasons": [{
        "field": "红人统一ID",
        "code": "SKIPPED_NO_KOL_UID",
        "reason": "缺少红人统一ID，已跳过"
      }]
    }]
  }
}
```

`code: 200` 表示接口处理完成，不表示候选成功写入。该行没有创建或更新任何档案，明确被跳过。这不是丢失编号的解析问题。

## 流程缺口

运行时 `backend/src/crawl/candidate-actions.ts` 的入库分支只构建公开平台资料 CSV，然后直接调用 `importKolProfilesFromCrawlerConfirmed`；没有先新建档案或找回编号，也没有在 CSV 中填入正式红人统一 ID。

另一路 `backend/src/host/discovery-ingest.ts` 已有两段式实现：真实联系邮箱及负责人 → `addKolProfile` 建档取得 `kolUid` → CSV 包含该编号 → 导入补平台资料。然而当前运行时没有复用这条编排。

| 前置条件 | 当前证据 |
|---|---|
| 正式 Starry 编号 | 本地只有候选占位编号；此前 Starry 可见列表未找到该频道 |
| 候选真实联系邮箱 | 本次采集候选没有 `email/contact_email/contactEmail` 字段 |
| 发现流程的新建档工具权限 | `creator_discovery` 只有 `importKolProfilesFromCrawler` 工具绑定 |
| 新建档工具本身 | `addKolProfile` 已绑定在另一技能 `creator_library_sync`；不能当成当前发现流程自动获权 |

既有 `addKolProfileConfirmed` 要求真实联系邮箱和有效负责人 openId，不允许编造邮箱或借用负责人邮箱。

## 本轮安全修复范围

仅补齐行级失败/跳过诊断：即使顶层成功，`failedCount > 0` 或 `skippedCount > 0` 也必须返回失败原因。失败行优先于已有编号及只读核对，不能因为拿到旧编号而误报本次写入成功。

新文案：**`Starry 入库未成功：缺少红人统一ID，已跳过`**。

新增四个回归用例，覆盖真实跳过回包、已知编号不能掩盖跳过、行级校验失败脱敏及零失败计数成功兼容。本地 32 个相关用例和类型检查通过。实际发布部署结果另见本轮部署日志。

本轮没有新授权 `addKolProfile`，没有补造候选邮箱，没有重新提交真实候选入库，也没有改变跟进关系。该红人仍不能认定已正式入库。

## 需要决定的下一步

建议把运行时发现入库改为正确的两段式流程，并在现有 L3 确认内校验新建档工具授权。对没有邮箱且无正式编号的候选，应在写入前明确提示缺少建档条件、保留本地跟进，不继续发送注定被跳过的 CSV。

若批准工具授权扩展，建议精确范围为：`runtime_skill_tools` 增加/启用 `(skill_id=creator_discovery, connector_id=starrykol, tool_name=addKolProfile, enabled=1)`；沿用该工具原有 `L3/write` 风险策略，不扩大其他技能或角色权限。仍须逐次确认真实入库，不自动重发 Outdoor Boys。

若要实际为 Outdoor Boys 新建档，还需提供或通过授权来源获得**真实联系邮箱**；仅有本次公开频道资料不足以满足现有建档契约。
