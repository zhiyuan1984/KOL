import { useEffect, useState } from "react";
import { reviewApi, reviewCompany, ReviewApiError } from "./api";
import { REVIEW_INBOX_CHANGED_EVENT } from "./inbox-events";

export type ApprovalBadgeSummary = {
  count: number;
  nativeCount: number;
  legacyCount: number;
  unreadCount: number;
  tenant: string;
};
type BadgeState = {
  accountId?: string;
  company: string;
  summary?: ApprovalBadgeSummary;
  error: string;
};

export function useApprovalBadge(accountId?: string, enabled = true, routeKey = "") {
  const company = reviewCompany();
  const [state, setState] = useState<BadgeState>({ company, error: "" });
  useEffect(() => {
    if (!accountId || !enabled) return;
    let mounted = true, inFlight = false, refreshAgain = false;
    let controller: AbortController | undefined;
    const sameScope = (value: BadgeState) => value.accountId === accountId && value.company === company;
    const refresh = async () => {
      if (!mounted) return;
      if (inFlight) { refreshAgain = true; return; }
      inFlight = true;
      controller = new AbortController();
      try {
        const summary = await reviewApi<ApprovalBadgeSummary>("/approvals/v2/badge", undefined, "GET", company, controller.signal);
        if (mounted) setState({ accountId, company, summary, error: "" });
      } catch (error) {
        if (!mounted || (error as Error).name === "AbortError") return;
        const denied = error instanceof ReviewApiError && [401, 403].includes(error.status);
        setState(previous => ({
          accountId, company,
          summary: !denied && sameScope(previous) ? previous.summary : undefined,
          error: error instanceof Error ? error.message : "审批计数加载失败",
        }));
      } finally {
        inFlight = false;
        if (mounted && refreshAgain) { refreshAgain = false; void refresh(); }
      }
    };
    const whenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const changed = () => { void refresh(); };
    void refresh();
    const timer = window.setInterval(whenVisible, 15000);
    window.addEventListener("focus", whenVisible);
    document.addEventListener("visibilitychange", whenVisible);
    window.addEventListener(REVIEW_INBOX_CHANGED_EVENT, changed);
    return () => {
      mounted = false;
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", whenVisible);
      document.removeEventListener("visibilitychange", whenVisible);
      window.removeEventListener(REVIEW_INBOX_CHANGED_EVENT, changed);
    };
  }, [accountId, company, enabled, routeKey]);
  const current = enabled && state.accountId === accountId && state.company === company;
  return { summary: current ? state.summary : undefined, error: current ? state.error : "" };
}

export function approvalBadgeLabel(count: number | undefined, error = "") {
  if (error) return count === undefined
    ? "审批，计数加载失败；打开审批后可重试"
    : `审批，${count} 条待处理；计数更新失败，显示上次结果`;
  return count === undefined ? "审批，待处理数加载中" : count > 0 ? `审批，${count} 条待处理` : "审批，暂无待处理";
}
