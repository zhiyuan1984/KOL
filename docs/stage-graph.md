# 业务规则与过程（E）— 阶段图

**本路径是别名。** E 层现行权威是 [`business-rules/stage-transitions.md`](business-rules/stage-transitions.md) 与 [`../config/stage-transitions.json`](../config/stage-transitions.json)（ADR-027）。

不要在本文件写阶段边。产品法（人可跨段 / 回退 / 进出异常，须原因；自动更严）只住在上述正文。Starry 相邻 hop 是物理适配，见 `07`，不得改写产品边。

- 现行动作闸门仍在 F：`policies/change_stage.yaml` 与剩余 `specs/FS-*`。
- ADR-011「相邻写入 = 产品法」已废止（ADR-027）。
- 权威分层：[`LAW-MAP.md`](LAW-MAP.md)。
