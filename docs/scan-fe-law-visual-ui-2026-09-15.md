# FE law scan — visual / UI (global styles, tokens, appearance)

Date: 2026-09-15  
Base: `cursor/docs-org-domain-canons-a1e1`  
Repo: `zhiyuan1984/KOL`  
Mode: **read-only**. No app patches. Suggestions only.

## Scope

Track: **global styles / tokens / appearance**.

| In | Out |
|---|---|
| `frontend/src/styles.css` (`:root`, chrome, buttons, Composer, ConfirmDialog skin) | Page IA / routing (H) |
| Raw hex and off-system color in shared chrome | Backend / FS / stage graph |
| Contrast, focus, color-only status | Implementing token remaps |
| Dense shadow vs hairline | New pages or visual redesign |
| Employee-visible engine jargon in chrome / shared dialogs | Admin-only Trace as a product feature |

**Law (this scan only):**

1. [`docs/design.md`](design.md) — class I visual entry; cite MASTER token **names**, no hex in new work.
2. [`docs/design-system/kol-workbench/MASTER.md`](design-system/kol-workbench/MASTER.md) — token source + density / a11y / shadow.
3. [`docs/design-system/kol-workbench/pages/*.md`](design-system/kol-workbench/pages/) — page overlays (Home / Chat / Pipeline / Admin / Approvals).
4. [`docs/CONSTITUTION.md`](CONSTITUTION.md) **§6 可用性底线** (keyboard, focus return, not color-only, WCAG 2.2 AA).
5. [`specs/UX-EMPLOYEE.md`](../specs/UX-EMPLOYEE.md) employee 禁词: MCP / Codex / Thread / 英文 Skill 时序 / 原始堆栈. Product noun「技能」is allowed (ADR-023).

`frontend/src/styles.css` is the token implementation fact (`design.md` §1 / MASTER §2). This scan treats leftover hex, migration aliases, and chrome that still paints like a second palette as debt — not as a new design system.

## Method

- Inventory `:root` vs MASTER §2–§3.
- Grep hex / `rgba` / `color-mix` fallbacks, `--star` `--canvas` `--line` `--muted` `--red` `--ok` `--orange`, `box-shadow`, `outline: none`, `transform: scale|rotate`.
- Read `ConfirmDialog.tsx` + `.admin-confirm*` and common chrome (sidebar, `.btn*`, Composer, RunHud, auth card).
- Classify employee-visible strings vs debug/admin-gated.

Severity:

| Level | Meaning |
|---|---|
| **P0** | Default employee or login chrome can fail contrast / focus / banned jargon now. |
| **P1** | Shared chrome off-system or against hairline / not-color-only / token-name rules; fix in the next visual pass. |
| **P2** | Migration alias debt, local tokens, or admin/debug-only copy. Do not invent hex to “fix”. |

## Already aligned (do not regress)

- `:root` core tokens match MASTER §2 names and values (`--bg` … `--warning`, radii, space, `--shadow-quiet`, type scale, durations). `styles.css:1–31`.
- Global `:focus-visible` ring uses `--focus-ring`. `styles.css:131–140`.
- `prefers-reduced-motion` exists (see P2 on *how*). `styles.css:6579–6597`.
- Approvals chrome is the closest to law: hairline `--border`, `--focus-ring`, no pending breath. `styles.css:3992–4004` vs `pages/approvals.md`.
- `ConfirmDialog` **CSS** uses MASTER tokens (`--bg`, `--border`, `--radius-md`, `--shadow-quiet`, `--space-*`, `--font-*`). `styles.css:3876–3943`.
- ConfirmDialog **behavior**: focus into cancel, Tab trap, Escape, restore trigger. `ConfirmDialog.tsx:38–50`, `54–76`. Matches CONSTITUTION §6 / MASTER §6 / Admin pages matrix (safe action first).
- RunHud / SideWorkbench status dots have adjacent Chinese labels, not color alone. `RunHud.tsx:22–28`, `SideWorkbench.tsx:474–478`.
- Employee jargon filters exist on discovery / connector / KB / chat traces (`DISCOVERY_BANNED_JARGON`, `stripEngineCopy`). Debug-only remote pills (`Chat.tsx:696`).
- Sidebar skills catalog is `debug` gated. `Workbench.tsx:149–162`. Product「技能」in Composer picker is allowed.

---

## P0

### P0-1 Auth / settings fields drop the global focus ring

`outline: none` is shared by Composer **and** `.field` controls. Composer later gets a `focus-within` box-shadow (`styles.css:2802–2805`). `.field` / `.search-box` / `.action-row` do not.

```css
/* frontend/src/styles.css:2859–2868 */
.composer textarea, .field input, .field textarea, .field select, .search-box,
.action-row input, .action-row select {
  outline: none;
}
```

Same-specificity later rule beats `input:focus-visible` at `styles.css:133–139`. Auth / Settings / mailbox fields (`styles.css:6464–6466` re-adds a border but does not restore a ring) therefore fail MASTER §6 (“不能通过 `outline: none` 无替代地移除”) and CONSTITUTION §6.

**Suggest:** Scope `outline: none` to `.composer textarea` only. Leave `:focus-visible` on `.field *`, or add `--focus-ring` on the field box (same pattern as `.hub-search-wrap:focus-within` at `styles.css:6263–6266`).

### P0-2 Login error chrome references undefined `--panel`

```css
/* frontend/src/styles.css:6452–6454 */
.auth-card .error-summary {
  border: 1px solid color-mix(in srgb, var(--red) 40%, var(--line));
  background: color-mix(in srgb, var(--red) 8%, var(--panel));
}
```

`--panel` is **never defined**. `color-mix` with a missing component is invalid; the error summary can lose its wash and fail 4.5:1 / 3:1 non-text contrast on the one screen that must explain login failure.

**Suggest:** Mix against `--bg` or `--bg-elevated`. Do not add `--panel`. Also stop using `--red` / `--line` here — use `--danger` / `--border` (`design.md` §2).

### P0-3 Idle send control is nearly invisible

```css
/* frontend/src/styles.css:4207–4226 */
.btn.send.send-arrow {
  background: var(--composer-side-btn-bg, #f5f5f5);
  color: var(--composer-send-idle, #cccccc);
}
.btn.send.send-arrow:disabled {
  color: var(--composer-send-idle, #cccccc);
  background: var(--composer-side-btn-bg, #f5f5f5);
}
```

`#CCCCCC` on `#F5F5F5` is ~1.2:1 (MASTER §6: text ≥ 4.5:1, non-text controls ≥ 3:1; disabled must still be distinguishable). The control is icon-only; disabled reason is not nearby (MASTER §6 last bullet). Enabled idle vs disabled is the same pair.

**Suggest:** Idle / disabled send should use `--text-muted` (or a named Composer token that meets 3:1 against `--composer-side-btn-bg`). Keep `#cccccc` out of new CSS. Explain empty / locked send in visible helper text (Chat `pages/chat.md` Composer matrix).

---

## P1

### P1-1 Two competing blues: Composer `#3568FF` vs `--primary` `#4F46E5`

MASTER §2 lists Composer tokens and says they **must not spread** to ordinary buttons / cards / page chrome. Implementation:

- Token defs + hex fallbacks: `styles.css:2746–2783`, and again on tools / chips / plus / send (`2316–2369`, `2681–2684`, `2853–2881`, `4213–4235`).
- Dark theme still mixes `#3568ff` (`2764–2783`).
- `.composer:focus-within` ring uses `--composer-accent`, not `--focus-ring` (`2802–2807`). Chat `pages/chat.md` asks for `--focus-ring`.

`#3568FF` is not `--primary`. Employees see indigo workbench + electric-blue Composer as two brands.

**Suggest:** Keep `--composer-*` on the input shell only. Focus ring → `--focus-ring`. Do not copy `#3568FF` into chips, page buttons, or fallbacks. If Composer must stay a distinct blue, promote one named token in MASTER + `:root` first (`design.md` §2).

### P1-2 `.btn.send` paints warning as the primary send

```css
/* frontend/src/styles.css:4199–4202 */
.btn.send {
  background: var(--orange);
  color: #ffffff;
  border-color: var(--orange);
}
```

MASTER §5: primary action uses **primary fill**; danger is reserved. `--orange` is the `--warning` alias. Non-arrow send (and any leftover `.btn.send` outside Composer) reads as “warning / interrupt”, not “do the task”.

Home / Agents already corrected `.btn.work` to `--primary` / `--primary-fg` (`4273–4279`). Send did not.

**Suggest:** Non-Composer send → `--primary` + `--primary-fg`. Composer arrow stays on Composer tokens. Drop `--orange` and raw `#ffffff`.

### P1-3 Hardcoded hex palettes in shared chrome (off-system)

MASTER §9 / `design.md` §2: no unexplained hex; no invented secondary. These clusters are not `--primary` / `--danger` / `--success` / `--warning` / `--border`:

| Cluster | Lines | Notes |
|---|---|---|
| Sidebar icon / disabled | `styles.css:274`, `330`, `188` | `#5c6370`, `#9aa0a8`, scrollbar hover `#b0b6be`. `#9aa0a8` on `--bg-elevated` `#F6F7F8` is ~2.8:1 — disabled “云盘 / 非本期” fails AA. |
| Status / RunHud | `362–370`, `3031–3044`, `3068–3073` | Idle `#b0b6be`, running `#4aa3e8` (not `--primary` / `--success`), wait border `#ffc9a8` / `#b8d4f0`. Breath glow is a second cyan. |
| Follow-style / kol style chips | `1619–1689`, `2099–2101` | Amber system `#ececef` / `#f0d3a8` / `#fff6e8` / `#8a5a12` / `#d8b27a` / `#ead7b4` / `#c9923a`. Home chrome, not Composer. |
| Sticky drop overlay | `2971–3005` | Yellow note `#fff9c4`–`#ffe082`, pin `#e85d5d` / `#b33`. Marketing, not hairline. |
| Todo urgency | `1425–1427` | `#fdecec`, `#b45309` / `#fff4e5`, `#8a6d3b` plus `--red`. |
| Task source / index | `2503–2511` | `#7653d7`, `#d98224`, `#a1a7af` (13px mono). |
| Task UX badges / risk bands | `5634–5671` | `#1677ff` (third blue), `#7f1d1d` / `#fee2e2`, L1 `#f4f5f7`, L2 `#eef6ff` + `rgba(22,119,255)`, L3 `#fff6f0`. Risk is color-band first. |
| Remote pills / agent avatar | `3573–3579`, `3598` | `#c8e6c9`, `#ffe0b2`, `#c45a00`, `#ffcdd2`, `#c43c3c` raw, gradient `#fff3e8`–`#ffe0c7`. Debug-gated **usage**, but the CSS is global. |
| Auth / journey / today | `745`, `1523`, `4198`, `5725` | `#333`, `#111111`, hover `#cfd2d6`. |
| Off-system fallbacks | `1282`, `5020–5026` | `var(--danger, #b42318)` ≠ MASTER `#C43C3C`. `var(--kb-ok, #008f6b)` / `var(--kb-warn, #e11d2e)` ≠ `--success` / `--danger`. |
| KB / bubbles / unread | `4299`, `4425–4436`, `5008`, `5303–5329`, `5511–5512` | Hard `#fff` / `#f3f4f6` / `#f6f7f8` / `#fdf4f4` / `#ea5504` instead of tokens. |

**Suggest:** Map each role to MASTER names (`--text-muted`, `--warning`, `--danger`, `--success`, `--bg-elevated`, `--border`). Add a semantic token only if a role is missing (e.g. “unread”, “risk-L2”) — do not keep `#1677ff` / amber / sticky yellow. Dark theme is already broken wherever `#fff` / `#111111` / `#333` are literal (`styles.css:74–107` remaps tokens only).

### P1-4 Dense shadows vs quiet hairline

MASTER §3 / `design.md` §2: shadow **only** `--shadow-quiet` (`0 1px 2px rgba(15,23,42,.06)`). Partitions use border + `--bg` / `--bg-elevated`.

| Selector | Line | Shadow |
|---|---|---|
| `.follow-style-panel` | `1668–1669` | `0 10px 28px rgba(15,23,42,0.12)` + raw `#fff` |
| `.sticky-note` | `2988` | `0 8px 24px rgba(240,180,41,.25)` gold glow |
| `.pipeline-drawer` | `4693` | `-12px 0 36px rgba(15,23,42,0.12)` |
| `.auth-card` | `6450` | `0 18px 50px rgba(15,23,42,.08)` + `--canvas` / `--line` + radius `16px` (not `--radius-md`) |
| RunHud breath | `3068–3073` | `0 0 0 6px` cyan / orange pulse |
| Pipeline exception / wait | `4654`, `4661` | `0 0 0 3px rgba(234,85,4,.16)`; inset `3px` danger |

Approvals / admin confirm already use `--shadow-quiet` or none. Auth + follow-style + pipeline drawer still look like elevated marketing cards.

**Suggest:** Default chrome → border + `--bg`. Floats (popover, drawer, dialog) → `--shadow-quiet` only. Kill gold / cyan glows. `pages/approvals.md` already forbids “重阴影”.

### P1-5 Color-only or color-first status

CONSTITUTION §6: 状态不能只靠颜色. MASTER §5 Chip: selected changes **background + border + text**.

Good: RunHud / SideWorkbench pair dot + text; Approvals path uses fill + outline + copy (`4023–4029`); stage chips selected use `--primary` + `--primary-fg` (`5734–5737`).

Gaps:

- `.status-dot` itself is a 6px circle (`362–371`). Safe only if every consumer keeps a label (today: SideWorkbench). Any future CSS-only use is color-only.
- `.run-hud[data-run-status="running"]` also changes border to `#b8d4f0` and breathes — extra color, still OK because of `<strong>执行中</strong>`.
- `.mail-unread-dot` (`5504–5512`) is an 8px `#ea5504` disc. AT gets `aria-label="未读"` (`AgentTaskList.tsx:328`); sighted users get color-only vs read rows (row wash is `color-mix(--star)` at `5501–5502`).
- `.todo-urgency.is-waiting` is **text color only** (`1427`, `#8a6d3b`) — no bg/border change vs default chip.
- `.task-source-mark` recolors the glyph only (`2503–2510`). Status also lives in `.task-meta` — keep that; do not drop copy.
- `.remote-pill` live-dot (`3569–3575`) is 6px; debug-only.
- `.pipeline-item.exception` inset bar (`4661`) is color-only unless the row also shows「异常」text (Pipeline `pages/pipeline.md`: 颜色必须配合文字).
- Risk L1/L2/L3 (`5646–5671`) are wash + border hue. Need a visible “草稿 / 确认” word in the card, not only the blue/orange band (CONSTITUTION §5 L2 label; Chat pages matrix).

**Suggest:** Every status chip/dot: text (or icon + text) + tokenized border/bg. Replace waiting urgency and unread with `--warning` / `--text` pair, not hex-only.

### P1-6 ConfirmDialog: always danger, raw errors, no `aria-busy`

Skin is on-token (see aligned). Component gaps:

| Issue | Where | Law |
|---|---|---|
| Confirm is always `className="btn danger"` | `ConfirmDialog.tsx:126–129` | MASTER §5: danger **only** for destructive. Current callers are admin deactivate / delete / archive / revoke — OK today. The shared primitive will paint “同意 / 发送” as danger if reused on Approvals / Chat L3. |
| Busy string only; no `aria-busy` on the dialog | `ConfirmDialog.tsx:91–98`, `133` | CONSTITUTION §6 / MASTER §6: loading containers expose busy. Approvals page matrix asks `aria-busy` on the confirm layer. |
| Error is `err.message` / `String(err)` | `ConfirmDialog.tsx:176` | UX-EMPLOYEE 禁词 / 原始堆栈. Host 4xx can surface MCP / Codex / `stage_code` on the L3 layer. |
| `--risk="L3"` is good; layer is `admin-confirm-*` even as the only shared dialog | `ConfirmDialog.tsx:84` | Naming is fine; do not fork a second visual dialog. |

**Suggest:** Variant prop (`danger` vs `primary`) when employee L3 shares this chrome. Map errors through `labels.ts` (already strips `stage_code` at `labels.ts:406–408`). Set `aria-busy={busy}` on the dialog. Do not restyle with hex.

### P1-7 Migration aliases still drive default chrome

`design.md` §2 / MASTER §2: `--star` `--canvas` `--line` `--muted` `--red` `--ok` `--orange` **禁止出现在新代码**. Aliases are defined at `styles.css:51–59` and used throughout chrome, including:

- Sidebar / menus / main: `--canvas` `--line` `--muted` (`337–393`, `673–714`).
- `.btn.work` / `.btn.selected` / `.btn.ghost`: `--star` `--canvas` `--line` (`4268–4287`).
- Journey current: `--star` (`734`).
- Attach / drop / run-hud remote: `--star` (`2686`, `2975–2979`, `3053`).
- Pipeline selected / current: `--star` `--orange` (`4632–4653`).
- Auth card: `--canvas` `--line` (`6450`).

Count: **38** `var(--star)` hits in `styles.css` alone.

Aliases currently equal core tokens, so *hue* is not wrong — the law break is **name**: new work cannot tell `--star` from a second primary, and `--orange` on `.btn.send` is already a semantic miss (P1-2).

**Suggest:** Mechanical rename in chrome to `--primary` / `--bg` / `--border` / `--text-muted` / `--danger` / `--success` / `--warning`. Keep aliases only as `:root` shims until the last call site is gone. No new `--star` in components.

### P1-8 Composer / sticky overlay fights “quiet hairline”

```css
/* frontend/src/styles.css:2971–2992 */
.attachment-card { border: 1px solid #f0d58a; background: linear-gradient(145deg, #fff9c4, #ffe082); transform: rotate(-1deg); }
.sticky-note { transform: rotate(-2deg); /* gold gradient + glow */ }
```

MASTER §1: 轻、安静、细边框; 避免营销落地页. §3: no `scale()`/`zoom` for density; rotate is the same class of fake decoration. `prefers-reduced-motion` kills animation duration, **not** the static tilt.

Employee copy is clean (`ComposerDock.tsx:500`). Debug copy is not (P2-3).

**Suggest:** Hairline `--border` + `--bg-elevated` overlay; no gradient, pin, tilt, or gold shadow.

### P1-9 Radii / type off the scale in chrome

MASTER §3: control `6px` (`--radius-sm`), panel `10px` (`--radius-md`). Found:

- `.btn` `border-radius: 8px` (`4189`) — magic number between sm/md.
- Nav links / tags / popover `border-radius: 0` (`280`, `340`, `349`) — sharper than the system; not illegal if intentional, but it is not a named token.
- `.auth-card` `16px` (`6450`).
- `.skill-option` `8px` (`2603`); hover/focus fill `#f3f4f6` (`2609–2611`) instead of `--bg-elevated`.
- `.journey-copy p` `#333` (`745`) instead of `--text`.
- `.kb-tip-x` 18×18 (`5004–5010`) — below 44×44 touch / 36 desktop (`CONSTITUTION` §6 / MASTER §6).
- `.status-dot` 6×6 — decorative only if labeled.

**Suggest:** Buttons → `--radius-sm`. Auth / panels → `--radius-md`. Close controls → 36px min hit area. No new 8px / 16px / `#333`.

---

## P2

### P2-1 `:root` extras that MASTER does not treat as design law

`--chrome-2: #eceef0`, `--sidebar-thumb: #c5c9d0` (`styles.css:61–62`, dark `87–88`). MASTER §2: 当前壳层变量, do not lock new pages to them.

`--kb-*` (`4848–4851`) map to core tokens — good — but call sites still ship off-system fallbacks (`5020–5026`). Page-local vars must not become a second palette (`design.md` / MASTER §2 last paragraph).

`--home-gutter` (`433`) is local; OK if not promoted.

Dark `:root` does not remap `--danger` / `--success` / `--warning` — MASTER table says “同语义变量”. Not a defect.

### P2-2 `prefers-reduced-motion` still animates for 0.01ms

`styles.css:6579–6597` sets `animation-duration: 0.01ms` globally, then `animation: none` on a few dots. MASTER §6: 直接呈现可读最终状态 — not a one-frame breath. Status that exists only as a pulse (RunHud running) must remain readable when motion is off (text is already there — keep it).

### P2-3 Employee 禁词: default path is mostly clean; leaks at edges

UX-EMPLOYEE / R-018: no MCP / Codex / Thread / English Skill 时序 / raw stack on **employee** surfaces.

| Location | Visible? | Verdict |
|---|---|---|
| `agentConfig.ts:11–15` `Starry KOL MCP`, `KOL Agent (Claw)` | Only when `debug` (`Chat.tsx:696`, `SimplePages.tsx:69`) | OK if debug stays off default |
| `SkillHub.tsx:85` title `Starry KOL MCP` | Connector tile; hub is debug/admin path per `Workbench.tsx:149` + org-permissions | P2: rename tile to business label even in debug |
| `ComposerDock.tsx:501` `走 Host 会话` | `debug` only | P2 |
| `ComposerDock.tsx:790` `<small>{skill.id}</small>` | `debug` only | English Skill id — keep gated |
| `ComposerDock.tsx:519` `skillLabel(row.skill_id)` | Employee picker | `knowledgeCopy.ts:150–152` maps or collapses to「技能」— OK |
| `Admin.tsx:332,434,524` Codex / extraRoots | Admin | Allowed on governance; still noisy vs `pages/admin.md` “技术详情按需展开” |
| `AdminKnowledge.tsx:98,168,250,278` `Codex harness` | Admin | Same |
| `AdminAgents.tsx:85` `manifest.yaml` | Admin TODO | Same |
| `confirmStageFeedback.ts:43,48,75` | **Employee** Home / stage confirm | Copy is Chinese; fallback `\|\| raw` and `mcp.message` can dump engine codes. “远程 Starry” is a vendor name, not MCP — acceptable; raw reason is not |
| `ConfirmDialog.tsx:176` | Admin today | P1-6 |
| `SideWorkbench.tsx:454,481` | Employee | `String(e)` / `e.message` on share errors |
| Discovery / KB / connector strippers | Employee | Good; keep as the pattern |

**Suggest:** Never render `err.message` on employee chrome. Map unknown `mcp_sync.reason` to「远程未写入」(`confirmStageFeedback.ts:42–43`). Do not show `Host` / `MCP` / `Codex` / `skill.id` unless `data-view-mode="debug"`. Admin Codex strings are out of this track’s P0.

「模型档位」in Settings / Composer (`AccountSettings.tsx:116`, `ComposerDock.tsx:801–805`) is product preference, not a banned engine word.

### P2-4 Positive page overlays (so the next pass does not “fix” them)

- Approvals: tokenized, no hex, no breath (`styles.css:3959–4102` vs `pages/approvals.md`).
- Admin confirm layer: tokenized (`3876–3943` vs `pages/admin.md` danger zone).
- Home `.btn.work` / discovery confirm already on `--primary` / `--danger` (`4273–4279`, `1281–1282` except the `#b42318` fallback).
- Chat Composer shell uses named `--composer-*` (keep them **inside** the shell).

---

## Suggested fix order (no patches in this PR)

1. **P0-1 / P0-2 / P0-3** — focus + auth error + send contrast. Token names only.
2. **P1-2 / P1-4 / P1-6** — send semantic, shadow hairline, ConfirmDialog busy/error/variant.
3. **P1-1 / P1-3 / P1-7** — one primary, delete hex clusters, rename aliases in chrome.
4. **P1-5 / P1-8 / P1-9** — status language, kill sticky-note, radii/type.
5. **P2** — local tokens, reduced-motion final state, debug/admin copy hygiene.

Do not introduce `--secondary`. Do not copy hex into `docs/design.md`. Change MASTER and `styles.css` together if a new role (unread, risk-L2, composer-idle) is required.

## Files touched by this report (evidence, not edits)

- `frontend/src/styles.css` (primary)
- `frontend/src/components/ConfirmDialog.tsx`
- `frontend/src/layout/Workbench.tsx` (chrome labels / debug skills)
- `frontend/src/components/RunHud.tsx`, `SideWorkbench.tsx`, `ComposerDock.tsx`
- `frontend/src/agentConfig.ts`, `pages/SkillHub.tsx`, `pages/Chat.tsx`, `confirmStageFeedback.ts`
- Law: `docs/design.md`, `docs/design-system/kol-workbench/MASTER.md` + `pages/*`, `docs/CONSTITUTION.md` §6, `specs/UX-EMPLOYEE.md`
