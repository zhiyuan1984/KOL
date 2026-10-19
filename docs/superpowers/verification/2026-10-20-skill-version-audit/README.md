# 技能版本依赖逐项审查

需求：用户要求判断所有技能的固定版本依赖是否有必要，不能因版本是 1 就视为合理；明确回复“执行”。

审宪：需求 → 智能体产品经理、架构师、后端专家、测试经理 → CONST-02/03/04/05/08/10 → PROD-PLAT-04、BIZ-02/03、TECH-ARCH-03/04、TECH-BE-01/07、TECH-TEST-01/03 → 符合。只修正无业务依据的实施前提，实际授权和受控工具路径继续执行。

范围：线上 35 项均为 bundled，无已发布自定义技能；本地 35 个 pack 逐项见 inventory.json。5 个普通读取技能原有固定 ontology@2：达人库查询已于 46719ec 移除；本次移除达人画像、达人筛选字典、邮件会话列表、邮件会话详情。实际需要的是 Starry 档案、字典或邮件读取契约，并无该本体修订版特有字段/规则处理。适用对象只用于语义标记，不自动等于强制版本依赖。

逐项结论：

| 技能 | 业务定义版本处理 | 保留的兼容契约 |
|---|---|---|
| 达人库查询 | 删除 kol_profile@2（前一提交） | creator.query@1 / creator.query_metrics@1 |
| 达人画像 | 删除 kol_profile@2 | creator.query@1 / creator.profile.read@1 / creator.platform_data.read@1 / 可选 mail.conversations.query@1 |
| 达人筛选字典 | 删除 kol_profile@2 | creator.dictionary.options@1 / creator.stages.options@1 / creator.risks.options@1 |
| 邮件会话列表 | 删除 email@2 | mail.conversations.search@1 |
| 邮件会话详情 | 删除 email@2 | mail.conversation.read@1 |

其余技能没有固定 ontology 依赖，保留原执行契约。能力版本保留的依据是参数、结果形状及适配映射，详见 inventory.json 中每个引用及 config/capability-operations.json；不能把定义版本、接口版本和发布内容哈希混为一种版本。不得把本次变更扩展为自动升级接口或工具。

未来显式采用公司业务定义的自定义技能：创建者选择对象/动作后，保留该正式版本快照、发布检查和升级核对；该版本用于规则语义兼容，与只读来源检索不同。未找到实际线上自定义技能，不虚构逐项业务审阅。要跟随当前定义的技能需另有明确契约和兼容测试，不在本次偷偷引入 latest 回退。

验证：29 项测试通过；后端类型、契约、registry 检查通过，固定版本缺失/停用/冲突和动作缺失仍被拒绝。4 个 pack 的 front matter 与 main 对比仅删 ontology，权限、context、适用对象、能力版本与工具声明不变。原始诊断与审核盘点分别保留，不将检查成功当作远端查询结果。

下一步：合并 push main、云效部署、核对线上技能目录与识别。部署未在此机器验证中声称完成。
