# FS-KOL-004 确认发送 L3

范围：员工明确确认后由 Gateway 提交一封邮件并保存远端回执。非目标：发送后自动推进阶段。

输入：草稿 ID、公司/品牌范围、收件人、确认指纹。输出：`sent`、远端消息 ID、会话 ID、receipt status、审计事件。

规则：BR-SEND-001 未确认不得调用 Gateway；BR-IDEMP-001 同一指纹只产生一次外部副作用；BR-SEND-002 真实发送需 app-server、MCP、allowlist；BR-STAGE-001 `stage_changed=false`。

实现引用：`send_email`、`backend/src/gateway/send.ts`、`starrykol.sendEmailNow`、`schemas/send-request.schema.json`。

验收（TEST-KOL-004）：第一次确认得到 SENT；并发重复确认只发送一次；不在 allowlist 的收件人或 KOL 在远端调用前拒绝；不确定回执不得显示成功。

评价：EVAL-KOL-003、EVAL-KOL-007、EVAL-KOL-008。
