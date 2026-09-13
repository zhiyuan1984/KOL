# FS-KOL-008 跨公司/品牌/区域拒绝

范围：所有 Turn、MCP 和 Gateway 请求带公司、组织、品牌、区域和对象范围。非目标：用姓名、部门文案或前端下拉推断权限。

输入：请求范围上下文、Agent manifest、对象归属、动作。输出：允许/拒绝、原因、审计事件。

规则：BR-SCOPE-001 PEP 只认 registry 和授权关系；BR-SCOPE-002 跨品牌、跨公司和未注册范围默认拒绝。

实现引用：`org-registry.yaml`、`brand-registry.yaml`、`agent:kol`、`requireConnector`、`assertCollaborationInScope`。

验收（TEST-KOL-008）：同一用户无目标品牌授权时拒绝；前端伪造 brand_id 不得改变结果；管理员也不能跳过副作用闸门。

评价：EVAL-KOL-003、EVAL-KOL-004。
