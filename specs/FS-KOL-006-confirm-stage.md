# FS-KOL-006 人工确认阶段

范围：员工确认具体目标阶段后，由 Host 校验范围、合法目标和版本，再提交远程阶段写入。非目标：发送自动改阶段、模型直接写阶段。

输入：`collaboration_id`、目标 `stage_code`、`expected_version`、公司/品牌范围、确认人。输出：阶段前后值、版本、远端回执或冲突。

规则：BR-STAGE-004 仅 `confirm_stage` 可写；BR-VERSION-001 必须校验版本；BR-STAGE-005 跳过、回退、异常和终态按人工目标处理；BR-AUDIT-001 保存 diff。

实现引用：`confirm_stage`、`change_stage`、`schemas/stage-confirm.schema.json`、`starrykol.changeLifecycleStage`。

验收（TEST-KOL-006）：缺确认、范围越权、版本冲突和无生命周期记录均拒绝；成功写入必须可回读。

评价：EVAL-KOL-005、EVAL-KOL-006。
