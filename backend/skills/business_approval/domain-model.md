# Domain model

Entities (v1): Employee, Organization unit, Relationship, ApprovalPolicy, ApprovalRequest, ApprovalStep, ApprovalDelegation, ApprovalAudit.

State machine: Draft → Submitted → Routing → Waiting Approval → Approved | Rejected → Completed.

Not in v1: parallel Legal+Finance, ERP budget live query, purchase/contract/hiring policies.

Boundary:

- LLM parses any language into `{requester, amount, ISO currency, purpose}`.
- FX and expense bands come from **this-round Codex web search**, cited in `fx` / `policy`. The search protocol lives in `approval-policy.md`.
- People come from this-round org binding (`organization-rules.md` until a remote bind exists). Not inferred from prose.
- Host validates names ∈ binding and that citations exist. Host does not treat TypeScript constants as the live policy.
