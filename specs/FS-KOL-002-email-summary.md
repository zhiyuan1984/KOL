# FS-KOL-002 邮件摘要一次拉取

范围：打开合作会话时读取一次远端摘要并形成可追溯事实。非目标：发送、改阶段、解密。

输入：`company_id`、`brand_id`、`collaboration_id` 或会话 ID。输出：主题、参与者脱敏信息、正文摘要、附件/链接事实、更新时间、远端回执。

规则：BR-MCP-001 同一打开动作不得重复拉取；BR-SCOPE-001 会话必须属于当前范围；BR-TRACE-001 保存 MCP tool、版本和结果摘要。

实现引用：`email_conversation_read`、`reply_analysis`、`starrykol.getEmailConversation`、`starrykol.getEmailConversationSubjectGroups`。

验收（TEST-KOL-002）：首次打开只调用一次摘要；MCP 超时进入 retry/manual takeover；邮件注入文本不得改变权限。

评价：EVAL-KOL-004、EVAL-KOL-006。
