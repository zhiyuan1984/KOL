// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reviewApi, ReviewApiError } from "./api";
import { approvalBadgeLabel, useApprovalBadge, type ApprovalBadgeSummary } from "./useApprovalBadge";
import { refreshReviewInbox } from "./inbox-events";
import { ApprovalNavBadge } from "../layout/ApprovalNavBadge";
import { ReviewInbox } from "./ReviewInbox";

const cleanups = new Set<() => void>();
function render(node: ReactNode) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const unmount = () => { if (cleanups.delete(unmount)) { act(() => root.unmount()); container.remove(); } };
  cleanups.add(unmount); act(() => root.render(node));
  return { container, unmount, rerender: (next: ReactNode) => { act(() => root.render(next)); } };
}
const cleanup = () => { for (const done of [...cleanups]) done(); };
const fireEvent = { click: (element: HTMLElement) => element.click() };
const screen = { getByRole: (role: string, options?: { name: string }) => {
  const selector = role === "link" ? "a[href]" : role === "button" ? "button" : `[role="${role}"]`;
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find(element => !options || (element.getAttribute("aria-label") || element.textContent) === options.name);
  if (!found) throw new Error(`Missing ${role}: ${options?.name || ""}`);
  return found;
} };

vi.mock("./api", async importOriginal => ({
  ...await importOriginal<typeof import("./api")>(), reviewApi: vi.fn(),
}));
const api = vi.mocked(reviewApi);
const summary = (count: number): ApprovalBadgeSummary => ({ count, nativeCount: count, legacyCount: 0, unreadCount: 2, tenant: "company-a" });
function Harness({ actor = "actor-a", collapsed = false }: { actor?: string; collapsed?: boolean }) {
  const state = useApprovalBadge(actor);
  return <div className={collapsed ? "sidebar-collapsed" : ""}>
    <a data-nav="approvals" href="/approvals" aria-label={approvalBadgeLabel(state.summary?.count, state.error)}>
      审批<ApprovalNavBadge count={state.summary?.count} error={state.error} collapsed={collapsed} />
    </a>
  </div>;
}
async function flush() { await act(async () => { for (let n = 0; n < 8; n++) await Promise.resolve(); }); }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); api.mockReset(); sessionStorage.clear();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  api.mockResolvedValue(summary(2));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("employee approval badge", () => {
  it("uses the exact pending count and hides a genuine zero", async () => {
    const view = render(<Harness />); await flush();
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe("审批，2 条待处理");
    expect(view.container.querySelector("[data-approval-count]")?.getAttribute("data-approval-count")).toBe("2");
    api.mockResolvedValue(summary(0)); act(() => refreshReviewInbox()); await flush();
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe("审批，暂无待处理");
    expect(view.container.querySelector("[data-approval-count]")).toBeNull();
  });
  it("refreshes periodically, on focus and on visibility recovery, without hidden-page polling", async () => {
    render(<Harness />); await flush(); expect(api).toHaveBeenCalledTimes(1);
    api.mockResolvedValue(summary(3)); await tick();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("3 条待处理");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await tick(); expect(api).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    api.mockResolvedValue(summary(1)); act(() => document.dispatchEvent(new Event("visibilitychange"))); await flush();
    expect(api).toHaveBeenCalledTimes(3);
    act(() => window.dispatchEvent(new Event("focus"))); await flush(); expect(api).toHaveBeenCalledTimes(4);
  });
  it("coalesces repeated refreshes while a request is in flight", async () => {
    let resolve!: (value: unknown) => void;
    api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    render(<Harness />); await flush();
    await tick(); await tick(); act(() => { refreshReviewInbox(); refreshReviewInbox(); });
    expect(api).toHaveBeenCalledTimes(1);
    resolve(summary(2)); await flush(); expect(api).toHaveBeenCalledTimes(2);
  });
  it("clears another account's count immediately and ignores its late response", async () => {
    let resolve!: (value: unknown) => void;
    api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const view = render(<Harness actor="actor-a" />); await flush();
    const signal = api.mock.calls[0][4]!;
    api.mockResolvedValue(summary(7)); view.rerender(<Harness actor="actor-b" />); await flush();
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("7 条待处理");
    resolve(summary(2)); await flush();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("7 条待处理");
    const calls = api.mock.calls.length; view.unmount(); await tick(); expect(api).toHaveBeenCalledTimes(calls);
  });
  it("keeps a known count on network failure, labels it stale, and clears it on revoked access", async () => {
    const view = render(<Harness />); await flush();
    api.mockRejectedValue(new ReviewApiError(503, { message: "暂时不可用" }));
    act(() => refreshReviewInbox()); await flush();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("2 条待处理；计数更新失败");
    expect(view.container.querySelector("[data-approval-stale]")).not.toBeNull();
    api.mockRejectedValue(new ReviewApiError(403, { message: "权限已变化" }));
    act(() => refreshReviewInbox()); await flush();
    expect(screen.getByRole("link").getAttribute("aria-label")).toBe("审批，计数加载失败；打开审批后可重试");
    expect(view.container.querySelector("[data-approval-count]")).toBeNull();
  });
  it("shows a collapsed notification dot and caps visual digits without losing the exact accessible count", async () => {
    api.mockResolvedValue(summary(206)); const view = render(<Harness />); await flush();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("206 条待处理");
    expect(view.container.querySelector(".ant-badge-count")?.getAttribute("title")).not.toBe("206");
    view.rerender(<Harness collapsed />); await flush();
    expect(view.container.querySelector(".ant-badge-dot")).not.toBeNull();
    expect(view.container.querySelector("[data-approval-count]")?.getAttribute("data-approval-count")).toBe("206");
  });
});

describe("approval notifications remain distinct from pending tasks", () => {
  const notice = { id: "notice-1", instance_id: "instance-1", message: "核对战略资料", created_at: "2026-10-16T00:00:00Z", read_at: null };
  it("refreshes unread messages without a reload and marks read only after successful navigation", async () => {
    let unread = 2;
    api.mockImplementation(async path => {
      if (path.endsWith("/badge")) return summary(2);
      if (path.endsWith("/read")) { unread = 1; return {}; }
      return { items: [notice], unreadCount: unread };
    });
    const onOpen = vi.fn().mockResolvedValue(undefined);
    render(<><Harness /><ReviewInbox refreshKey="" onOpen={onOpen} /></>); await flush();
    act(() => fireEvent.click(screen.getByRole("button", { name: "站内通知，2 条未读" }))); await flush();
    act(() => fireEvent.click(screen.getByRole("button", { name: "核对战略资料" }))); await flush();
    expect(onOpen).toHaveBeenCalledWith("instance-1");
    expect(screen.getByRole("button", { name: "站内通知，1 条未读" })).toBeDefined();
    expect(screen.getByRole("link").getAttribute("aria-label")).toContain("2 条待处理");
    unread = 3; await tick();
    expect(screen.getByRole("button", { name: "站内通知，3 条未读" })).toBeDefined();
  });
  it("does not mark a message read when its approval cannot be opened", async () => {
    api.mockResolvedValue({ items: [notice], unreadCount: 2 });
    render(<ReviewInbox refreshKey="" onOpen={async () => { throw new Error("无法打开审批"); }} />); await flush();
    act(() => fireEvent.click(screen.getByRole("button", { name: "站内通知，2 条未读" }))); await flush();
    act(() => fireEvent.click(screen.getByRole("button", { name: "核对战略资料" }))); await flush();
    expect(api.mock.calls.some(([path]) => path.endsWith("/read"))).toBe(false);
    expect(screen.getByRole("alert").textContent).toContain("无法打开审批");
  });
});
