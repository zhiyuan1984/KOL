# Tools

| Tool | Owner | LLM may call? | Notes |
| --- | --- | --- | --- |
| Codex **网络搜索** `web_search` / `$web-search` | Codex built-in | **required** for FX and expense bands | Not a Host MCP. Do not bare-HTTP crawl. Protocol: `approval-policy.md`. |
| `get_current_user()` | Host | yes | identity only |
| `get_employee(employee_id)` | Org binding | yes | this-round snapshot / remote bind |
| `get_manager_chain(employee_id)` | Org binding | **read only** | never invent names |
| `get_org_unit(org_id)` | Org binding | yes | this-round fact |
| `validate_approval_request()` | Host | yes | missing amount / unknown requester |
| `create_approval()` | Workflow | yes, **with** cited `fx` / `policy` / `chain` | Host validates people ∈ binding and citations exist. Host does not restaff or re-FX. |
| `get_approval_status()` | Workflow | yes | persisted record |
| `get_approval_history()` | Audit | yes | persisted record |
| `send_approval_reminder()` | Workflow | yes | does not restaff |
| `cancel_approval()` | Workflow | yes | requester or admin |

Host `calculate_approval_plan()` / TypeScript `FX_TO_CNY` / `FIN-EXP` are **stub and offline fallback only**. Do not read them as the live source. Changing a band or rate = edit `approval-policy.md` (search queries + 政策公布页), not TypeScript.

`create_approval` Item shape: see `approval-policy.md`. Host strips `chain` when `fx` / `policy` have no `source_url` or quote.
