import type { KnowledgePublication } from "../../../shared/knowledge-publication";
import type { ReviewCommand, ReviewInstance, ReviewOrganizationContext } from "../../../shared/review";
export type InstanceView = ReviewInstance & {
  allowedActions: string[];
  knowledgePublication?: KnowledgePublication | null;
  candidates?: { transfer: string[]; countersign: string[] };
  revisions?: {
    round: number;
    values: Record<string, unknown>;
    actor: string;
    created_at: string;
  }[];
  events?: {
    id: string;
    actor: string;
    action: string;
    version: number;
    detail: { reason?: string };
    created_at: string;
  }[];
};
export type ReviewContext = {
  organization?: ReviewOrganizationContext;
  intake?: { allowed: boolean; reason: string };
  tenant: string;
  actor: string;
  admin: boolean;
  people: {
    id: string;
    name: string;
    managerIds: string[];
    roles?: string[];
  }[];
};
export const reviewCompany = () =>
  new URLSearchParams(window.location.search).get("reviewCompany") ||
  sessionStorage.getItem("review.company") ||
  "";
export const reviewHeaders = (): Record<string, string> =>
  reviewCompany() ? { "X-Review-Company": reviewCompany() } : {};
export class ReviewApiError extends Error {
  get issues() { return typeof this.detail === "string" ? [] : this.detail.issues || []; }
  constructor(readonly status:number, readonly detail: {message?:string;code?:string;issues?:{path:string;message:string}[]}|string) {
    super(typeof detail === "string" ? detail : [detail.message, ...(detail.issues || []).map(issue => `${issue.path}: ${issue.message}`)].filter(Boolean).join("\n") || "请求失败");
  }
}
export async function reviewApi<T>(
  path: string,
  body?: unknown,
  method = "POST",
  company?: string,
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : method,
    headers: {
      ...(company === undefined ? reviewHeaders() : company ? {"X-Review-Company":company} : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) {
    const detail = data.detail || data;
    throw new ReviewApiError(r.status, detail);
  }
  return data;
}
export const prepareReview = (command: ReviewCommand) =>
  reviewApi<{
    confirmationId: string;
    expiresAt: string;
    summary: {
      name: string;
      version: number;
      consequence: string;
      scope?: string;
      configuration?: string;
      reviewers?: string[];
    };
  }>("/approvals/v2/prepare", command);
/** 知识工作区批量操作（续期 / 归档）：走统一 review 租户头。 */
export const workspaceBatch = (
  items: { id: string; asset: "entry" | "document" }[],
  action: "renew" | "archive",
  expires_at?: string,
) =>
  reviewApi<{ results: { id: string; ok: boolean; error?: string }[] }>(
    "/admin/knowledge/workspace-v1/batch",
    { items, action, expires_at },
  );
