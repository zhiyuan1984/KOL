import { extractRemoteIntentText, intentLlmApiKey, intentLlmFetch, intentLlmModel } from "../tasks/openai-intent.js";

export type QaLunaUsage = { input_tokens: number | null; output_tokens: number | null; total_tokens: number | null };
export type QaLunaResult = { text: string; usage: QaLunaUsage | null; model: string };
export type QaLunaDeps = { fetch?: typeof fetch; apiKey?: string; baseUrl?: string; model?: string; timeoutMs?: number };
export class QaLunaUnavailable extends Error {
  constructor(public code: string) { super(code); this.name = "QaLunaUnavailable"; }
}
export function qaTimeout(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(30000, Math.floor(n)) : fallback;
}
function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** One model call only. The deadline covers both transport and JSON body consumption. */
export async function callQaLuna(
  request: { name: string; instructions: string; input: unknown; schema: Record<string, unknown>; timeoutMs: number },
  deps: QaLunaDeps = {},
): Promise<QaLunaResult> {
  const key = deps.apiKey ?? intentLlmApiKey();
  if (!key) throw new QaLunaUnavailable("missing_credentials");
  const model = deps.model ?? intentLlmModel();
  const base = (deps.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new QaLunaUnavailable("timeout")); }, deps.timeoutMs ?? request.timeoutMs);
  });
  try {
    const work = (async () => {
      const response = await (deps.fetch ?? intentLlmFetch())(`${base}/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, instructions: request.instructions, input: JSON.stringify(request.input), store: false,
          reasoning: { effort: "low" },
          text: { format: { type: "json_schema", name: request.name, strict: false, schema: request.schema } },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new QaLunaUnavailable(`http_${response.status}`);
      const data: unknown = await response.json();
      const rawUsage = data && typeof data === "object" ? (data as Record<string, unknown>).usage : null;
      const u = rawUsage && typeof rawUsage === "object" ? rawUsage as Record<string, unknown> : null;
      const inputTokens = tokenCount(u?.input_tokens ?? u?.prompt_tokens);
      const outputTokens = tokenCount(u?.output_tokens ?? u?.completion_tokens);
      const totalTokens = tokenCount(u?.total_tokens) ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
      const usage = inputTokens === null && outputTokens === null && totalTokens === null ? null : {
        input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens,
      };
      return { text: extractRemoteIntentText(data), usage, model };
    })();
    return await Promise.race([work, deadline]);
  } catch (error) {
    if (error instanceof QaLunaUnavailable) throw error;
    throw new QaLunaUnavailable(controller.signal.aborted ? "timeout" : "transport_error");
  } finally { if (timer) clearTimeout(timer); }
}
