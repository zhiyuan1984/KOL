# Evidence: 智能体中台法律缺口扫描（2026-09-14）与修宪落地

- **Date:** 2026-09-14
- **User lock:** 产品负责人确认同日——产品是**智能体中台 / Agent middle platform**；十六项一等能力；KOL 只是首个试点。
- **Mode:** 文档 only。**No LIVE.** 不改 JSX / CSS / API。
- **Status:** **Amendments landed** in the PR that adds ADR-023. 本文件原为缺口扫描；下列「落地」栏指向已改正文。权威清单以 `CONSTITUTION.md` §4.1–4.2 为准。

## 总判

扫描属实：宪法与员工契约把中台写成 KOL 壳，并把「支撑能力面 / 员工默认禁技能 / 数字团队≈专家团」写成易降等或永久禁词。本 PR 只修宪与路由，不实施数字团队 UI，不强制侧栏加技能。

## 用户锁定（权威）

十六项全部是一等公民，互不隶属，不隶属 KOL Agent：

1. 任务/会话
2. 数字员工
3. 数字团队 — 独立；**尚未实现**；预留法律地位；禁止专家团假导航；**不得**永久禁止产品名词「数字团队」
4. 技能 — 一等；**侧栏可见是 UX**，不是硬「员工永远不许看见技能」
5. 知识库
6. 连接器（使用 ≠ 管理治理，保留）
7. 审批
8. 人员与权限
9. 审计/Trace
10. 考试（一等）
11. 项目（占位可）
12. 云盘（占位可）
13. 手机遥控电脑（占位可）
14. 定时/自动化
15. 通知/收件箱
16. 个人设置

元条款：KOL 是本中台上的第一个业务实现/试点。Pipeline / Home「AI发现」「我跟进的红人」是 KOL 试点特化，不是平台壳。

保留：ADR-015 精神（能力主权、会话单向调用、使用≠治理、支撑面不做第二套 Home）；发送 ≠ 推进阶段；L1–L3。

## 缺口 → 落地

| # | 扫描到的缺口 | 落地（本 PR） |
|---|---|---|
| 1 | `CONSTITUTION.md` 标题/导语「KOL Workbench-only」；无十六项清单；「支撑能力面」易读成二等；未写 KOL=首个试点 | 改题为智能体中台；§4.1 十六项；§4.2 试点元条款；「支撑」≠ 二等；`kol-workbench` 路径=试点皮肤名 |
| 2 | `employee-surface-contracts.md`：技能硬隐藏；「数字团队」与专家团划等号并禁词 | 技能=一等，入口密度=UX，禁图鉴压过脊柱；数字团队预留未实现；只禁专家团假导航 |
| 3 | `docs/README.md` 无平台能力 vs KOL 试点路由 | 裁决表 +「平台能力 vs KOL 试点」节，指向宪法清单 |
| 4 | `21-admin-employee-page-roles.md` 仍写支撑/员工默认禁技能图鉴进侧栏 | 轻同步：一等能力、技能 UX、数字团队预留、KOL 试点 Pipeline |
| 5 | 无 ADR 记录此次锁定 | `DECISIONS.md` ADR-023；修订 ADR-016 相关读法 |
| 6 | 项目/云盘/遥控/定时/收件箱缺页级「只回答」 | `employee-surface-contracts.md`「预留 / 占位能力（只回答）」 |

## 明确不改（本 PR）

- 任何 frontend / backend / CSS / e2e
- 不实施数字团队 UI
- 不强制员工侧栏加技能
- 不重命名 `design-system/kol-workbench/`
- 不重写全部 19 时代历史正文；`19-ui-ux-constitution.md` 仍只是迁移指针

现行 stub E2E 仍断言侧栏无「技能目录」/「数字团队」——那是**实现快照**，不是 ADR-023 的永远禁令。后续若做技能入口或数字团队面，应对照宪法清单改测试，而不是把旧断言当成产品法。

Pipeline 侧栏残留已在 `docs/evidence-constitution-reconcile-2026-09-14.md` 硬锁：**禁止**员工侧栏挂「生命周期」或 `/pipeline` 主入口；页只许深链 / CTA。

## 交叉引用

- 宪法：`CONSTITUTION.md` §4.1–4.3
- 员工契约：`employee-surface-contracts.md`
- 双端：`21-admin-employee-page-roles.md`
- 决策：ADR-023（修订 ADR-016 技能/数字团队读法；服从 ADR-015）
- 路由：`docs/README.md`「平台能力 vs KOL 试点」
