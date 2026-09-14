# Evidence: employee core surfaces — constitution rescan2 (2026-09-14)

- **Date:** 2026-09-14
- **Scope:** Home / Chat / Workbench chrome only. No LIVE. No backend. No Pipeline sidebar entry.
- **Law:** `CONSTITUTION.md` §4.1–4.2, ADR-018, ADR-023, `21-admin-employee-page-roles.md`
- **Aesthetic:** `docs/references/openai-style.md` as direction only. MASTER tokens in `frontend/src/styles.css` / `design-system/kol-workbench/MASTER.md` stay authoritative (`--primary` indigo `#4F46E5`, not OpenAI black CTAs).

## Findings → fixes

| # | Rescan2 finding | Fix | Files |
|---|---|---|---|
| 1 | Chat task header still showed「✦ AI 发现」when `source===ai` | Header uses ADR-018「今天推荐」via `todayTaskOriginLabel`. Non-ai copy stays「今天的工作」 | `frontend/src/pages/Chat.tsx` |
| 2 | Debug「技能目录」sat inside `aria-label="数字员工"` | When shown, it is its own first-class `nav[aria-label="技能"]`, not under `/agents`. Default (non-debug) still hides it. Digital-employee cluster remains `/agents` only. **Pipeline not added.** | `frontend/src/layout/Workbench.tsx` |
| 3 | Core chrome felt heavy / decorative vs OpenAI quiet | Hairline borders, `--shadow-quiet` or none, no orange-filled rail. CTAs keep MASTER indigo. No new hex palette. | `frontend/src/styles.css` (Workbench / Home / Chat chrome only) |

## Stub checks

- Chat session with `source: "ai"` → `[data-task-source=ai]` = `今天推荐`; body must not contain leftover task-header「AI 发现」.
- Default sidebar: `nav[aria-label="数字员工"] [data-nav]` count 1; `[data-nav=skills]` / `nav[aria-label="技能"]` count 0; `[data-nav=pipeline]` count 0.
- Debug toggle: `[data-nav=skills]` visible under `nav[aria-label="技能"]`, not inside the digital-employee cluster.

## Out of scope

- LIVE send / stage write
- Backend copy or APIs
- Pipeline sidebar
- Overriding `--primary` / `--focus-ring` / Composer tokens
- Connector / Admin / Pipeline page redesign
