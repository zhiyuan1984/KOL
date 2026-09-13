# FS-KOL-005 回复分析

范围：按正文、附件/链接、履约事实、主题顺序分析合作阶段和风险。非目标：直接写正式阶段。

输入：会话事实、当前阶段、远端阶段字典和风险矩阵。输出：建议阶段、置信度、证据指针、风险标签、下一步和是否需要人工确认。

规则：BR-STAGE-002 正文优先于主题；BR-STAGE-003 仅感谢、延期关怀、暂缓和明确拒绝不得误判；BR-TRACE-002 结果必须带证据。

实现引用：`reply_analysis`、`starrykol.getStageRiskMatrix`、`starrykol.listCooperationStageOptions`。

验收（TEST-KOL-005）：主题与正文冲突时正文胜出；“Thank you”不等于有兴趣；延期不自动判违约。

评价：EVAL-KOL-004、EVAL-KOL-005。
