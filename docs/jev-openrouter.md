# Jev through OpenRouter

The KOL backend uses Jev as a bounded first-pass classifier for free-text task routing. The integration calls OpenRouter’s TypeSafe-compatible System One endpoint through the official `@typesafe-ai/sdk`; it never exposes the credential to the browser.

## Environment configuration

Configure these variables in the repository-root `.env` file. The file is ignored by Git and should be readable only by the service account.

```dotenv
OPENROUTER_API_KEY=sk-or-v1-...
JEV_MODEL=jev-1.13
JEV_INTENT_TIMEOUT_MS=8000
JEV_INTENT_MIN_CONFIDENCE=0.80
JEV_INTENT_LOW_CONFIDENCE=0.60
```

`JEV_MODEL` is intentionally pinned to `jev-1.13` in production. Update it only after a representative regression evaluation. The backend sends the model, user text, and current task-directory criteria to `https://openrouter.ai/api/v1/systemone` using the server-side OpenRouter key.[1]

## Routing policy

| Jev result | Host behavior |
|---|---|
| Confidence ≥ `JEV_INTENT_MIN_CONFIDENCE` | Accept the bounded task type as the first-pass routing result. |
| Confidence from `JEV_INTENT_LOW_CONFIDENCE` up to the high threshold | Ask the existing Luna/Codex classifier for a second judgment. |
| Confidence below `JEV_INTENT_LOW_CONFIDENCE` | Return a direction clarification; do not guess a task type. |
| OpenRouter/Jev timeout or failure | Preserve the existing Luna/Codex fallback path. |

Jev only chooses from the current registered task IDs plus an explicit `clarification` option. Deterministic host code continues to extract fields and validate email addresses, allowed IDs, required inputs, and permissions. Therefore a model classification cannot directly perform a write or bypass an existing validation boundary.

## Verification

Run the local, mocked verification suite from `backend/`:

```bash
npm run typecheck
npm test -- tests/openai-intent.test.ts
```

The targeted suite verifies the TypeSafe-compatible OpenRouter request shape, the high/medium/low confidence policy, the Luna fallback, and test isolation. Use a production smoke request only with non-sensitive text and a valid server-side key.

[1]: https://openrouter.ai/docs/guides/community/typesafe-sdk
