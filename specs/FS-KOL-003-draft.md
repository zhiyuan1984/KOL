# FS-KOL-003 邮件草稿 L2

范围：根据当前合作阶段、事实和 Skill 生成可编辑英文草稿。非目标：发送、自动改阶段、猜邮箱、猜金额。

输入：合作对象、已核验收件邮箱、发件邮箱选择、阶段事实、模板知识、员工补充字段。输出：`create_draft`、英文主题/正文、中文内部译稿、缺口、Skill/知识版本。

规则：BR-DRAFT-001 缺字段进入 `waiting_input`；BR-MAIL-001 多个授权邮箱必须人工选择；BR-STAGE-001 草稿不推进阶段。

实现引用：`email_compose`、`schemas/send-request.schema.json`、`starrykol.previewEmailDraft`。

验收（TEST-KOL-003）：缺 To、金额或阶段事实时不产生可发送草稿；员工编辑后只保留编辑版本；预览不触达 Gateway。

评价：EVAL-KOL-001、EVAL-KOL-002、EVAL-KOL-008。
