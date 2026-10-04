import { randomUUID } from "node:crypto";

type ResponseLike = { status: number; body?: unknown; json?: () => Promise<unknown> };

/** Simulate the human-reviewed UI protocol in legacy business tests. Never used by runtime code. */
export async function confirmAndSendDraft<T extends ResponseLike>(
  request: (method: string, url: string, body?: unknown) => Promise<T>,
  draftId: string,
  edits: Record<string, unknown> = {},
): Promise<T> {
  const draftUrl = `/api/drafts/${encodeURIComponent(draftId)}`;
  if (Object.keys(edits).length) {
    const saved = await request("PATCH", draftUrl, edits);
    if (saved.status >= 400) return saved;
  }
  const view = await request("GET", `/api/queries/mail.draft-actions?draft_id=${encodeURIComponent(draftId)}`);
  if (view.status >= 400) return view;
  const data = (view.json ? await view.json() : view.body) as { action?: { confirmation_version?: string } };
  return request("POST", "/api/actions/mail.send", {
    draft_id: draftId,
    confirmation_version: data.action?.confirmation_version || "",
    request_id: randomUUID(),
  });
}
