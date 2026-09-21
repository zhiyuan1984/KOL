# MCP 主数据能力评估

## 结论

Starry KOL MCP 可以提供 KOL 业务域的事实主数据，不能替代企业组织主数据源。安培时代的公司名称、组织树、部门负责人和部门负责人公司级范围政策已由业务方确认并进入 registry；`data/kol/邮箱-负责人绑定清单.md` 是 100% 真实的 KOL 邮箱业务事实源。结合截图、绑定清单和远程 MCP 只读结果，安培时代试点 PEP 正式授权已确认；其它身份字段只是非阻断待办。

## 2026-09-12 真实只读探测

| MCP 工具 | 结果 | 可用于 | 不能替代 |
|---|---|---|---|
| `listMailboxOwnerOptions` | PASS，返回负责人 openId、姓名、邮箱、工号 | 邮箱负责人事实、邮箱管理下拉 | 公司成员关系、岗位任期、授权范围 |
| `pageMailboxes` | PASS，返回 5 个邮箱、2 个品牌、6 个授权用户及负责人/移交状态 | 邮箱—品牌—负责人授权事实、PEP 绑定证据 | 完整企业组织树；未返回的品牌邮箱不能被虚构 |
| `listDictionaryOptions(mailbox_brand_affiliation)` | PASS，返回 LT/RO/PQ | 邮箱品牌字典 | 企业品牌 registry；当前未返回 TB |
| `listDictionaryOptions(mailbox_responsible_status)` | PASS，返回 ACTIVE/TRANSFERRED | 邮箱负责人状态 | 完整员工在职/离职/委托主数据 |
| `listCooperationStageOptions` | PASS，返回阶段名称、顺序、定义和旧码 | 合作阶段映射和版本校验 | 平台是否允许某用户写阶段 |
| `getStageRiskMatrix` | PASS，返回阶段风险标签、定义和版本 | 风险识别与评价输入 | 审批和权限决定 |
| 公司/租户/组织/部门/成员/区域/责任关系工具 | 未发现 | — | 必须由组织系统或平台 registry 提供 |

## 使用边界

1. MCP 返回的负责人姓名和邮箱不能单独替代组织授权；但与已确认组织截图、真实邮箱负责人清单和 registry 绑定合并后，可以作为安培时代试点 PEP 的正式核验事实。
2. 邮箱品牌字典需要与 `config/brand-registry.yaml` 对账；TB 远端差异本轮按业务负责人指示豁免验收，但运行时仍保留无回退保护。
3. 远程阶段代码存在旧码（例如 `INTEREST_CONFIRMED`），必须映射到平台 canonical code，不能把远程字符串直接当平台主键。
4. 任何阶段写入、发信、解密、导入仍必须经过 Host/PEP/Gateway、确认、幂等和审计。

## 决策

Starry MCP 作为 KOL 域事实源接入；组织 registry 作为安培时代试点授权源；两者通过外部引用和版本快照关联。截图确认组织树，邮箱绑定清单确认业务绑定，MCP 负责校验远端邮箱/负责人事实，三者共同完成试点 PEP 授权。KOL Agent 仍需通过 Agent 发布、品牌连接器、全量测试和真实阶段写入等其它生产门禁后才能升级状态。

## 图片证据绑定（用户确认）

已确认公司名称为“安培时代”；“品牌与用户增长中心”和“推广部”的负责人分别为张慧玲、刘敏。该事实已写入 `config/org-registry.yaml`，`company:amperetime` 已作为试点 canonical company 引用；部门负责人全范围政策已确认并执行。张慧玲正式 user_ref、双方邮箱、工号、任职时间以及普通成员的品牌/区域明细仍作为 `TODO-ORG-002` 至 `TODO-ORG-004` 的非阻断待办。远程 MCP 只读探测已记录为 9 个负责人、5 个邮箱、2 个品牌、6 个授权用户。
