# Test cases

Implemented in `backend/tests/approval-engine.test.ts`.

## Org

- 黎玉燕 / 陈冰冰 / 叶观旺 / 林桐 / 王主管 / 张总 manager chains
- mailbox lookup (case-insensitive)
- name hint only from snapshot
- finance / GM / department_leader roles
- circular hierarchy, broken edge, unknown employee

## Cited search plan (live source)

- Searched USD rate (e.g. 7.13) is kept; Host must not replace it with the stub 7.2 table
- Policy id and quote come from the citation, not from TypeScript `FIN-EXP`
- Unknown chain name is rejected
- Missing `source_url` / quote → Host does not accept the chain

## Stub / offline fallback (not the live source)

- CI `CODEX_MODE=stub` still uses Host `calculateApprovalPlan` when the worker emits facts only
- Changing a live band or rate = edit `approval-policy.md`, not `policy.ts`

## Routing

Skill aliases (zh / en / de / ja / ko). Quote-confirm must not enter this skill.

## Host path

Path lookup replays the last stored expense. Missing amount still supplements. Persisted chain stays in business language.
