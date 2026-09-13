# ChangeStageRequest 形状证据（2026-09-13）

## 结论

允许名单 KOL 上的相邻前进 LIVE 写入已证明：`changeLifecycleStage` 必须使用 `toStageCode`。这解除相邻 hop 的 LIVE 写入阻断，**不是完整生产放行**。

## 已执行

- 测试 KOL：`KOL202607300002`（允许名单）
- 合作轮次：lifecycle **16**
- 动作：相邻前进 `INTEREST_CONFIRMED` → `COOPERATION_EVALUATION`
- 入口：Host / 探针调用 Starry KOL MCP `changeLifecycleStage`

## 有效请求

顶层 MCP 参数只能是：

```json
{
  "lifecycleId": 16,
  "requestJson": "{\"toStageCode\":\"COOPERATION_EVALUATION\",\"reason\":\"...\"}"
}
```

`requestJson` 体只能是 `{ toStageCode, reason }`，其中 `toStageCode` 为 Starry 原生码。

## 无效字段（均返回误导性「回退」）

- `cooperationStageCode`
- `targetStageCode`
- `stageCode`
- 把 `lifecycleId` 或阶段码塞进与 `requestJson` 重复的顶层字段

## 回读

`currentStageCode=COOPERATION_EVALUATION`。

## 发布影响

- 相邻 hop 的 LIVE 写入按此形状解阻。
- 人确认 skip 仍只在 Host 记账；远程按 `planStarryAdjacentWalk` 逐格写 `toStageCode`。
- 不得把单次相邻成功写成全量阶段机、skip-walk 或生产放行。
