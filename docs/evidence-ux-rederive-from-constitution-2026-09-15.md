# Evidence: 从宪法重派生员工 UX（2026-09-15）

- **Date:** 2026-09-15
- **Authority:** `CONSTITUTION.md` §4.1–4.2（ADR-023）、§5 L1–L3；`docs/04-ux-ui-system.md`（L3 确认形状、发送/阶段/解密/导入/删除分卡）。本文件只记删改与派生，不另立法。
- **Mode:** 文档 / 契约 only。**No LIVE.** 不重画 Home 跟进列表视觉。不 force-push `main`。
- **Decision:** ADR-024。

用户判定：`specs/UX-KOL.md`、`specs/UX-FOLLOWED-KOL-CARD.md`，以及把 `UX-SEND-NE-STAGE` 当独立合同 ID 的绑定，含大量不合理过细处方。删除后只从更高位阶重派生。

## 删除

| 工件 | 处置 |
|---|---|
| `specs/UX-KOL.md`（整文件，含节 `UX-SEND-NE-STAGE`） | **删除** |
| `specs/UX-FOLLOWED-KOL-CARD.md`（整文件） | **删除** |
| `UX-SEND-NE-STAGE` 作为独立合同 ID / 文件级绑定 | **废止**；硬不变量改由 `SEND_NE_STAGE` 指向宪法 / 04 |
| 旧 ID 目录：`UX-CTX-BRAND`、`UX-DEF-MAILBOX-N`、`UX-MAIL-STATUS`、`UX-TB-BIND`、`UX-AGENT-UNPUBLISHED`、`UX-OWNER-NOT-SKIP`、`UX-STATE-VISIBLE`、`UX-COPY-ENGINE` | 退出 `ux-traceability.json` 门禁。对应系统法若仍在宪法 / 04 / FS，继续有效，不再各自升格为 UX 合同 ID |

## 不复活的过细处方

- 1→8 排序键表、用户开关改比较键的教条
- 绝对禁止任何阶段筛选（阶段筛选允许二次或产品自选主筛选，但不得克隆 Pipeline 正式资产板）
- 强制四带-only 布局
- 长字段黑名单（`collab_summary` 等不得当列的细则表）
- 强制每张 Home 卡 CTA 拼「确认进入「目标阶段」」

## 新派生

| 路径 | 角色 |
|---|---|
| `specs/UX-EMPLOYEE.md` | 瘦员工 UX 契约。声明从宪法 §4–5 + 04 派生，位阶低于二者 |
| `specs/ux-traceability.json` | 只绑 `SEND_NE_STAGE`、`L3_CONFIRM` |
| `backend/scripts/validate-contracts.mjs` | 改认 `UX-EMPLOYEE.md`，不再要求 `UX-KOL.md` |

## 必须存活的硬不变量（引用宪法 / 04，不发明）

| 规则 | 出处 | 新落点 |
|---|---|---|
| 发送 ≠ 推进阶段；发送卡不得带阶段选择；阶段写入要具体 `stage_code` + 展示名，不能用「下一阶段」 | 宪法 §3 / §4.2；04「消息和操作」 | `SEND_NE_STAGE` + 04 分卡句 |
| L3：高影响写前展示对象/范围/后果 → 确认 → 执行 → 持久回执；拒绝要原因 | 宪法 §5；04 L3 | `L3_CONFIRM` |
| Home「我跟进的红人」是 KOL 试点 Collaboration 表面，不是第二套 Pipeline 资产板 | 宪法 §4.2–4.3 | `UX-EMPLOYEE` 目标段 + GWT；无四带教条 |
| 员工表面无 MCP / Codex / Thread / 英文 Skill 时序 / 原始堆栈 | 04 双端边界 | 04 + `UX-EMPLOYEE` 原则段；不另建膨胀 ID |
| Pipeline 页仍在、可深链；不要求默认侧栏 | 宪法 §4.2 | `UX-EMPLOYEE` + employee-surface / 21 |

Home 四模式（今日任务 / 我的待办 / AI发现 / 我跟进的红人）仍引用 `employee-surface-contracts.md` 与 ADR-018，本轮不重写。

## 指针更新

现行入口改为 `UX-EMPLOYEE.md`：`CONSTITUTION.md` 裁决表、`docs/README.md`、`docs/CONTEXT-MANIFEST.md`、`docs/04-ux-ui-system.md`（验收表瘦身）、`docs/21-admin-employee-page-roles.md`、`docs/employee-surface-contracts.md`、`specs/README.md`。FE 注释去掉对已删文件名的硬绑定（`followedKolCard.ts`）。历史 `docs/evidence-*` 与 `references/legacy-visual-design-system.md` 保留快照，并加 superseded / note。

## 明确不改

- Home「我跟进的红人」视觉 / JSX 布局（除合同路径注释）
- LIVE、Host API、Pipeline 页删除、`FS-KOL-010`
- 宪法 L1–L3 形状、发送/阶段/解密/导入/删除分卡（04 系统法保留）
