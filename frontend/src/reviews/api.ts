import type { ReviewCommand, ReviewInstance } from "../../../shared/review";
export type InstanceView = ReviewInstance & {
  allowedActions: string[];
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
export async function reviewApi<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    credentials: "same-origin",
    method: body === undefined ? "GET" : method,
    headers: {
      ...reviewHeaders(),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) {
    const detail = data.detail || data;
    throw new Error(
      typeof detail === "string"
        ? detail
        : [
            detail.message,
            ...(detail.issues || []).map(
              (i: { path: string; message: string }) =>
                `${i.path}: ${i.message}`,
            ),
          ]
            .filter(Boolean)
            .join("\n"),
    );
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
      reviewers?: string[];
    };
  }>("/approvals/v2/prepare", command);
