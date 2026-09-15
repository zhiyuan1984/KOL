# Frontend law scan — Admin* + Pipeline

- **Date:** 2026-09-15
- **Track:** Admin* + Pipeline
- **Base:** `cursor/docs-org-domain-canons-a1e1` @ `f76512c`
- **Repo:** https://github.com/zhiyuan1984/KOL
- **Mode:** Read-only. No app code patches. Suggestions only.

## Law stack

| Layer | Document | What this track reads |
|---|---|---|
| B | `docs/CONSTITUTION.md` §3 / §4 / §5 | One-question surfaces; L1–L3; send ≠ stage; P0 confirm/audit not dropped for chrome |
| H | `docs/ia-information-architecture.md` | Admin ≠ employee Home; use ≠ govern; Pipeline ≠ Home four modes / sidebar |
| C | `docs/org-permissions.md` | Admin suite: hub, `/admin/agents`, audit slices, leftover collapse, same tokens / different IA |
| E | `docs/business-rules/stage-transitions.md` (ADR-027) | Human may jump / back / enter-leave `exception`; UI must not pretend adjacent-only |
| G | `specs/UX-EMPLOYEE.md` `L3_CONFIRM` / `SEND_NE_STAGE` | Object + scope + consequence; concrete `stage_code`; reject needs a reason |
| I | `docs/design.md` → `docs/design-system/kol-workbench/MASTER.md` + `pages/admin.md` + `pages/pipeline.md` | Semantic tokens; governance table IA; Pipeline asset page |
| J | `docs/technical-constitution.md` | Host is the only gate. FE submits confirm intent. Admin entry ≠ Host bypass |

## Files in scope

| File | Role |
|---|---|
| `frontend/src/pages/AdminConsole.tsx` | Admin chrome, tabs, employees / exams / data / grants |
| `frontend/src/pages/Admin.tsx` | Skills governance (embedded as `/admin/skills`) |
| `frontend/src/pages/AdminConnectors.tsx` | Connector hub + detail |
| `frontend/src/pages/AdminAgents.tsx` | Digital-employee publish / scope / exam / matrix (read-mostly) |
| `frontend/src/pages/AdminKnowledge.tsx` | Knowledge publish / archive / delete / proposals |
| `frontend/src/pages/Pipeline.tsx` | KOL-pilot formal asset board |
| `frontend/src/components/ConfirmDialog.tsx` + `frontend/src/adminConfirm.ts` | Admin L3 shell |

Related (cited only, not a second track): `Workbench.tsx` nav, `UserMenu.tsx`, `SkillHub.tsx`, `SimplePages.tsx` `Admin`, `ChatBlocks.tsx` `ConfirmStageArtifact` (handoff destination).

## Method

Static read of the listed TSX plus routing / nav / token CSS. No LIVE, no patches, no new UX IDs.

Severity:

- **P0** — product-wrong: wrong surface, skipped L3 on a formal/destructive write, or stage UI that rewrites E.
- **P1** — clear law miss that should be fixed before the next Admin / Pipeline UI PR.
- **P2** — leftover chrome, token aliases, density, copy.

---

## Verdict

| Check | Verdict | Top finding |
|---|---|---|
| 1. Admin is governance, not an employee Home clone; no `/agents` / `/connectors` deep-link confusion | **Partial** | Suite IA is governance (tables, hub, return-to-Home). Same nav words + `/admin`「配置」→ employee `/connectors` still confuse use vs govern. |
| 2. L3 confirm on destructive admin writes | **Partial** | Disable / revoke / archive / hard-delete / skill-delete use `ConfirmDialog`. Publish, grant-write, credential-ref, retention, skill unpublish, and proposal reject do not. Cancel has no reject reason. |
| 3. Pipeline = KOL-pilot asset page; not Home four modes; stage → `confirm_stage` L3 with concrete `stage_code`; product edges | **Fail** | Not a Home clone (pass). Stage CTA leaves the page with intent only — no `stage_code`, no on-page L3, linear 15-dot rail pretends +1-only. |
| 4. Visual tokens | **Partial** | Admin shell mostly MASTER. Pipeline still on migration aliases + raw rgba. Nested scroll on both surfaces. |
| Host gates (J) | **Pass** | Listed pages do not write `stage_code` or call MCP. Pipeline defers to Host `confirm-stage` via Chat. Admin writes go `/api/admin/*`. |

---

## P0

### P0-1 — Pipeline stage CTA has no concrete `stage_code` and no on-page L3

**Evidence**

`Pipeline.tsx` `proposeStageChange` opens a Chat session and stores:

```ts
storePending(ses.id, { text: `提出阶段变更 @${card.handle}`, collaboration_id: card.id, intent: "confirm_stage" });
```

No `stage_code`. The drawer footer is a single button「提出阶段变更」(`data-intent="confirm_stage"`). It does not show object / scope / consequence, does not name a target stage, and does not use `ConfirmDialog`.

`pages/pipeline.md`: advance actions must show precondition, **target stage**, and impact; irreversible stage writes are L3 and keyboard-complete **on this page**.

B §4.2 / G `SEND_NE_STAGE`: formal stage write must name a concrete `stage_code`, not「下一阶段」. G `L3_CONFIRM`: object + scope + consequence before execute; reject needs a reason.

**Why P0.** The only stage action on the asset page is an unlabeled handoff. The operator never confirms a named `stage_code` on Pipeline.

**Suggestion (no patch).** Keep the Host path (`intent: confirm_stage` → session → `confirmSessionStage`). On the drawer, require a picked `stage_code` (and display name), render L3 facts, then submit that code. Do not treat「提出阶段变更」as a complete write.

---

### P0-2 — Pipeline stage UI pretends a single adjacent rail (rewrites E)

**Evidence**

The board and the drawer both render a 15-column `stage-track` (`grid-template-columns: repeat(15, …)`). Dots are only `done` / `current` / `idle` along `MAIN_STAGE_TABS` order. `aria-label` is「15 阶段进度」. There is no picker for:

- skip ahead (e.g. `CONTRACTING` → `CONTENT_PLANNING`)
- back
- enter / leave `exception`

`EXCEPTION_STATES` in `Pipeline.tsx` lists `PAUSED` / `LOST` / `REJECTED` / `CANCELLED` / `DISPUTED` / **`COMPLETED`**. E: `COMPLETED` is a Host terminal after settlement, **not** a product-graph node, and not a 16th main stage. `exception` is one product node; Host kinds are not extra nodes.

E §3: humans may jump, back, and enter/leave `exception` (those three **require_reason**). Happy-path +1 is a recommendation, not the only legal edge. 「前端不得把目标列表收成『只能选下一格』。」ADR-011 adjacent-only is abolished.

I `pages/pipeline.md`: stage is a business state, not a paint label; next legal actions must be shown.

**Why P0.** The only stage picture on the page is a linear milestone rail. That is the old adjacent-only product story.

**Suggestion (no patch).** Keep the 15-code axis as a *location* legend. Add an honest target list from Host / `stage-transitions.json` (main + `exception`), grouped, never defaulted to「next」. Do not put `COMPLETED` on the product node list.

---

### P0-3 — High-impact admin writes skip L3 (object / scope / consequence)

`ConfirmDialog` + `adminConfirm.ts` cover six kinds only: `user-deactivate`, `connector-disable`, `grant-revoke`, `knowledge-archive`, `knowledge-hard-delete`, `skill-delete`. Those six do show 对象 / 范围 / 后果 and `data-risk="L3"`.

The same suite still executes the following **without** that shell:

| Write | Where | Why it is L3-class |
|---|---|---|
| Knowledge「审批发布」 | `AdminKnowledge.tsx` — `api.approveKnowledge` on review + drafts | Formal asset into the operator library (B §5 正式业务资产变更 / 导入正式资产) |
| Grant **write** / **read** | `AdminConnectors.tsx` `setAccess` — confirm only on revoke | C + `pages/admin.md`: permission change → L2/L3; B §5 权限变更 |
| Credential `credential_ref` PATCH | `AdminConnectorDetail` `submitRef` | C: credential change; `pages/admin.md` 密钥轮换 |
| Retention policy PATCH | `AdminConsole.tsx` `DataPanel` | Audit / session retention — high-impact governance write |
| Skill 下架 / 上架 | `Admin.tsx` `toggleMarket` | Changes what employees can see/use |
| Approval-role save | `AdminConsole.tsx` `GrantEditor` | Permission assignment |
| Knowledge proposal 否决 | `AdminKnowledge.tsx` — `reviewKnowledgeProposal(..., "reject", "否决保留")` | G: reject must be a **user-filled** reason, not a hardcoded string |

B §3: P0 confirm / audit / permission constraints must not be dropped for a shorter form. B §5 / G `L3_CONFIRM`: trigger → confirm (object / scope / consequence) → in-flight → durable receipt. Toast is not the receipt.

Enable / create-user / create-exam are weaker; see P1/P2.

**Suggestion (no patch).** Extend `AdminConfirmKind` (or a shared L3 card) to publish, grant-write, credential-ref, retention, unpublish, and proposal reject. Reject must collect a reason. Keep Host `/api/admin/*` as the writer — this is UI confirm, not a second gate.

---

## P1

### P1-1 — `ConfirmDialog` close path has no reject reason

G `L3_CONFIRM`: 「拒绝必须填写原因（与确认相对的关闭路径）」.

`ConfirmDialog` cancel is a bare「取消」: Escape / backdrop / button, no reason field, then `setPending(null)`. Confirm of a Host *proposal* (stage / approval) clearly needs a reason. Admin self-started confirms are closer to abandon-without-side-effect. The shared L3 shell still does not implement the G close path, so any caller that treats cancel as「拒绝」fails the invariant.

**Suggestion.** If the dialog is the L3 close path, require a reason on reject. If cancel is only「don't do the write I opened」, say so in copy and do not reuse this shell for Host-proposal reject.

---

### P1-2 — Same words on both ends:「数字员工」「连接器」

Employee `Workbench` sidebar:「数字员工」→ `/agents`,「连接器」→ `/connectors`.

Admin `TABS`:「数字员工」→ `/admin/agents`,「连接器」→ `/admin/connectors`.

H §3 / C: use and govern may be **配套** (same object, different question). They must not share chrome or be readable as copies. C already forbids Admin top bar「员工 · 智能体」→ `/agents` (that jump is gone — pass). Identical labels still make `/admin/agents` look like the employee expert center and `/admin/connectors` look like the employee use list.

`AdminAgents.tsx` body copy is correct (「开工请走员工导航」; matrix cells do not link `/agents`). The nav word is what collides.

**Suggestion.** Admin nav:「数字员工治理」/「连接器枢纽」(or C's「发布 / 授权 / 考试闸门」). Keep employee words on the use surfaces.

---

### P1-3 — Admin「配置」tab deep-links the employee connector use page

`AdminConsole` tab `kol` renders `SimplePages.tsx` `Admin`. That page still has:

- 「打开连接器枢纽」→ `/admin/connectors`
- **「打开员工使用面」→ `/connectors`**
- kicker「协作」, title「管理配置」

H §3: Admin top bar must not jump an employee start surface and call it governance. C leftover table: `Admin.tsx` / SimplePages connector lists converge on the hub; brand mailboxes belong on connector detail. C also: Admin IA is 员工目录 / 枢纽 / `/admin/agents` / 审批 / 考试 / 知识 / 审计 — not a second「配置」workbench with an employee `/connectors` CTA.

**Suggestion.** Drop the employee `/connectors` link from Admin. Redirect「配置」to the hub or delete the leftover list.

---

### P1-4 — `/admin/skills` still uses employee SkillHub funnel IA

Embedded `Admin.tsx` filters skills with `FUNNEL` chips (建联 / 意向 / 评估报价 / …) and `HubTile` cards from `SkillHub.tsx`. That is the employee catalog / KOL-funnel chrome, not C's「页头 + 表/行 + 授权矩阵」.

C: Admin is not a second Agents / Home. I `pages/admin.md`: no card wall instead of list/detail.

**Suggestion.** Skills governance = table (id, publish state, grants, last edit) + danger zone for delete (already L3). Funnel chips stay on the employee / debug catalog.

---

### P1-5 — `AdminKnowledge` is a six-step workbench, not a governance table

Hero:「原文进库 → 抽出待审 → 发布给运营 → 看反馈」with `kb-hero` / `kb-step` (employee KB classes). Six numbered panels, upload, extract, approve, brand-copy, evolve proposals.

C / H: Admin knowledge answers 谁发布、是否停用、哪个版本、适用哪些品牌/区域 — not an employee library and not a second Home. I `pages/admin.md`: overview → permission/config → health → audit; danger zone last.

Publish without L3 is P0-3. The IA/chrome clone is P1.

**Suggestion.** Collapse to asset table + review queue + version drawer + isolated proposal queue. Keep employee `/kb` as find / preview / favorite / use-in-task.

---

### P1-6 — Nested scroll (B §3)

B §3: one main scroll container; no hard-to-find nested scroll.

- Admin: `admin-nav-list { overflow: auto }` **and** `admin-body { overflow: auto }` inside a full-height grid.
- Pipeline: page scroll **and** `pipeline-drawer-body { overflow: auto }` in a `position: fixed` dialog.

I allows a *controlled* horizontal scroller on wide tables (`admin-table-wrap`, `pipeline-table`). A second vertical pane is the miss.

**Suggestion.** One vertical scroller per surface. Drawer: either take the only scroll or lock the board while open.

---

### P1-7 — Pipeline `COMPLETED` treated as an exception node

`EXCEPTION_STATES` includes `{ code: "COMPLETED", label: "已完成" }` and is the fallback when `data.side_stages` is empty.

E §1: `COMPLETED` is not a product-graph node. Exception kinds (`PAUSED` / `DISPUTED` vs `LOST` / `REJECTED` / `CANCELLED`) are kinds of the one `exception` node, not nodes 17–21.

**Suggestion.** Filter to E's 15 + `exception`. Show Host kind as a label on `exception`, not a sixth rail state.

---

## P2

### P2-1 — Pipeline tokens are migration aliases + raw rgba

`styles.css` Pipeline block uses `--line`, `--canvas`, `--chrome`, `--muted`, `--star`, `--orange` (MASTER §2: migration aliases; new work uses core `--border` / `--bg` / `--bg-elevated` / `--text-muted` / `--primary` / `--warning`).

Raw color:

- `.milestone.is-current { box-shadow: 0 0 0 3px rgba(234, 85, 4, 0.16); }` (hex of `--warning`)
- `.pipeline-item.exception .pipeline-row { box-shadow: inset 3px 0 0 rgba(196, 60, 60, 0.7); }` (hex of `--danger`)

Inline layout styles on `h1` and the exception muted line. Filter `<select>` padding `3px 8px` is below MASTER desktop control height (36–40) and far below 44px touch.

**Suggestion.** Retoken to core names; `color-mix` from `--warning` / `--danger`; bump control size.

---

### P2-2 — Admin token / chrome nits

Passes: `admin-shell` / confirm / status / receipt use `--bg`, `--primary`, `--danger`, `--success`, `--radius-*`, `--font-*`, `--shadow-quiet`. Health bar is text, not `remote-pill` (C).

Nits:

- `AdminConsole` `data-visual="docs20"` points at retired `docs/20`, not `design.md` → MASTER.
- Header `h1` is the **account name**, not the governance object (`pages/admin.md`: top = governance object + tenant + one admin action).
- Connector health counts stay on **every** tab (employees / knowledge / exams). Fine as a strip; it is not per-object.
- `admin-nav-item` `min-height: 36px` meets desktop density, misses 44px touch (`MASTER` §6).
- `Admin.tsx` inline `style={{ marginTop: 0 }}`, `style={{ width: 240 }}`.
- `AdminKnowledge` uses page-local `--kb-ok` / `--kb-warn` (`#008f6b`, `#e11d2e`) — MASTER: page vars do not enter the system; success/danger already exist.
- Embedded skills login still titled「产品经理登录」with a second password form inside an already-gated `/admin`.

---

### P2-3 — SkillHub debug tiles still deep-link `/admin/connectors/:id`

`SkillHub.tsx` `CONNECTORS[].to` is `/admin/connectors/enterprise_mail` etc. Render is gated `debug && admin` (C allows that). Leftover: employee catalog chrome that jumps the hub from a skill page; C wants SkillHub bricks only in explicit debug, target = hub.

`SkillHubChrome`「+ 新建技能」→ `/admin/skills` when `admin` is on — a second Admin door besides UserMenu「管理控制台」. C: employee → Admin only via the account chip.

**Suggestion.** Debug tiles → `/admin/connectors` (hub), not a fake detail id. Do not put「新建技能」on the default employee skill chrome.

---

### P2-4 — Admin receipt is in-page status, not a durable business receipt

Successful admin saves set `notice` / `sopNotice` (`role="status"`, `data-admin-receipt`). Better than a toast; it dies on navigation and is not an audit row. B §5: toast must not replace the business receipt; C audit slice is the durable record. Bind-audit empty state already says not to use Pipeline events as audit (correct).

**Suggestion.** Keep the on-page line; point「已停用 / 已发布」at the audit slice for that object.

---

### P2-5 — Weaker writes without confirm (not P0)

Create employee (password), create/assign exam, connector create, connector **enable**, knowledge extract / new draft / new version. Create-user and enable are reversible or L2-ish. Extract is draft (L2 — already copy-marked「未发布」). Not P0 unless product later treats account-create as L3.

---

## Passes (do not regress)

1. **Admin is not a Home clone.** No「今日任务 / 我的待办 / AI发现 / 我跟进的红人」, no todo buckets, no「再开一单」. Chrome is nav + tables + forms. `data-admin-ia="governance"`.
2. **Employee sidebar does not deep-link Admin.** `/agents` and `/connectors` are use surfaces. Pipeline is **not** a default nav item (H §4 / C). Admin entry is UserMenu「管理控制台」→ `/admin` (gated `available_modes`).
3. **Admin hides the employee sidebar** (`.workbench.admin-surface > .sidebar { display: none }`). Allowed return:「← 返回员工工作台」→ `/`.
4. **`/admin/agents` is not `/agents`.** Read-only publish / writable-scope / exam / matrix. No summon, no Chat, no start-task. TODOs do not invent `PATCH` or deep-link employee cards.
5. **`/admin/connectors` is a hub, not a use-list clone.** Status copy is 未挂接 / 已登记 / 已启用. Secrets never echo; ref input clears after submit. Starry personal bind is `Navigate` to `/settings?tab=starry`; detail says Settings owns the mailbox. Enable copy: 启用不等于远端已通，也不绕过 Gateway (J).
6. **Six destructive kinds use L3 `ConfirmDialog`** with 对象 / 范围 / 后果, focus trap, restore focus, default focus on cancel (`pages/admin.md`).
7. **Pipeline is not Home.** Copy and e2e assert「不是今日待办」; filters are brand / owner / stage / region / sync; no mail/risk CTAs on the board. Home → `/pipeline?kol=` is an allowed product CTA (H).
8. **Host not bypassed.** No `changeLifecycleStage` / MCP from these pages. Stage write is `POST /api/sessions/:id/confirm-stage` from Chat after Host cards. Admin mutations are `/api/admin/*`.
9. **Audit slice exists** (connector / grant / bind) and refuses to treat Pipeline events as connector audit.
10. **Admin visual baseline** uses semantic tokens and a table IA, not a second Agents hero / `remote-pill` strip.

---

## Out of scope (this track)

- Home / Chat / Approvals L3 cards (`ChatBlocks.tsx` `ConfirmStageArtifact` does list Host targets and requires a concrete code + reason on skip/correct/exception — relevant as the Pipeline handoff, not scored as Admin/Pipeline source).
- SkillHub / employee `/kb` / `/connectors` full IA (only cited where they deep-link Admin or vice versa).
- Backend `legalTargets` / `hostConfirmStage` (J/E implementation). FE must not re-decide edges; it must **display** Host/E edges.
- LIVE MCP / production enablement.

---

## Suggested fix order (no patches in this PR)

1. **Pipeline stage honesty (P0-1, P0-2, P1-7):** on-page target `stage_code` + L3 facts; product edges from E/Host; drop `COMPLETED` as a node; keep Host `confirm_stage` as the only writer.
2. **Admin L3 holes (P0-3, P1-1):** publish, grant-write, credential-ref, retention, unpublish, proposal reject; reject reason on the close path that means「拒绝」.
3. **Use ≠ govern labels / leftover (P1-2, P1-3, P1-4, P1-5):** rename Admin nav; kill `/connectors` from「配置」; stop SkillHub-funnel and KB-hero clones on Admin.
4. **Scroll + tokens (P1-6, P2-1, P2-2):** one vertical scroller; core MASTER tokens on Pipeline; drop `docs20` / raw rgba / undersized filters.
