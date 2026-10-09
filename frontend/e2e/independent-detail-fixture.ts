import { type Page } from "@playwright/test";
export const BUSINESS_ID = "task_0f246ea43b2a";
export const title = "跟进：MAX BUSHCRAFT（youtube）";
export const rootTask = { id: BUSINESS_ID, task_id: BUSINESS_ID, task_type: "business_task", title, source: "manual", status: "open", display_status_label: "未开始", goal: null, description: "完成对 MAX BUSHCRAFT 的跟进，直到转化或放弃", priority: "normal", risk_level: "none", created_at: "2026-10-09T02:09:00Z", updated_at: "2026-10-09T02:09:00Z", runs: [], artifacts: [], session_id: null };
export const businessTask = { task_id: BUSINESS_ID, title, goal: "完成对 MAX BUSHCRAFT（youtube：UC9oYA9Hy2dZwqIhL_CMd_kA）的跟进，直到转化或放弃", status: "open", priority: "normal", due_at: null, data_version: 1, workspace_allowed: true, created_at: rootTask.created_at, updated_at: rootTask.updated_at };
export const counts = { total: 0, open: 0, blocked: 0, waiting_review: 0, completed: 0, automatic_created: 0, automatic_assigned: 0 };
export const verified = { id: "event-fixture", event_type: "lead.created", summary: "线索建档：MAX BUSHCRAFT（youtube）", evidence_ref: "fixture:private-evidence", occurred_at: "2026-10-09T02:09:00.123Z", verified_at: "2026-10-09T02:09:00.123Z", verified_by: "fixture-actor" };
export const aggregate = { task: businessTask, counts, work_orders: [], verified_events: [verified], current_blocking_work_order: null, source: "postgresql_task_work_orders", as_of: "2026-10-09T07:00:00Z" };
export const agent = { id: "agent-fixture", title: "MAX 资料分析", task_type: "analysis_skill", skill_template: { code: "analysis_skill", title: "资料分析" }, status: "completed", source: "manual", description: "核对来源与资料", session_id: "session-fixture", created_at: "2026-10-09T02:08:00Z", updated_at: "2026-10-09T02:08:00Z", runs: [], artifacts: [{ id: "artifact-fixture", title: "来源核对报告", summary: "测试中的真实接口产物字段" }] };
export type FixtureOptions = { relatedDenied?: boolean; rootDeniedAfterRelated?: boolean; theme?: string; unknownType?: boolean; rootStatus?: number; rootNetworkFailure?: boolean; aggregateStatus?: number; eventStatus?: number };
export async function independentFixture(page: Page, options: FixtureOptions = {}) {
  let reads = 0, writes = 0, revoked = false;
  const bodies: unknown[] = [];
  const apiErrors: string[] = [];
  page.on("pageerror", error => apiErrors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() !== "GET") {
      writes++;
      bodies.push(request.postDataJSON());
      if (path.endsWith("/verified-events")) return route.fulfill({ json: { event: { id: "registered-fixture", replayed: false }, decision: { id: "decision-fixture", outcome: "skip", status: "recorded", confidence: null }, execution_job: { id: "job-fixture", status: "queued" }, execution_mode: "async", request_id: "fixture-request" } });
      return route.fulfill({ status: 400, json: { error: "No actual side effect allowed in isolated UI fixture" } });
    }
    if (path === "/api/health") return route.fulfill({ json: { runtime_mode: "postgres-only" } });
    if (path === "/api/me") return route.fulfill({ json: { id: "fixture-actor", name: "测试用户", roles: ["employee"], available_modes: ["employee"], workspace_key: "fixture-company" } });
    if (path.includes("preferences")) return route.fulfill({ json: { theme: options.theme || "light" } });
    if (path === "/api/tasks/operations-dashboard") return route.fulfill({ json: { period: url.searchParams.get("period") || "realtime", metrics: { total: 1, queued: 0, running: 0, waiting: 0, completed: 1, cancelled: 0, overdue: 0, failed: 0 }, status_distribution: { queued: 0, running: 0, waiting: 0, completed: 1, failed: 0, cancelled: 0 }, task_types: [], timezone: "Asia/Shanghai", as_of: "2026-10-09T07:00:00Z" } });
    if (path === "/api/tasks") return route.fulfill({ json: { items: [agent], page: { total: 1, next_cursor: null } } });
    if (path === `/api/tasks/${BUSINESS_ID}`) {
      reads++;
      if (options.rootNetworkFailure) return route.abort("failed");
      const status = options.rootStatus || (revoked ? 403 : 200);
      return route.fulfill({ status, json: status === 200 ? { ...rootTask, ...(options.unknownType ? { task_type: "future_unregistered_type" } : {}) } : { error: "not_available" } });
    }
    if (path === "/api/tasks/agent-fixture") return route.fulfill({ json: agent });
    if (path.endsWith("/events") && path.startsWith("/api/tasks/")) return route.fulfill({ status: options.eventStatus || 200, json: options.eventStatus ? { error: "trace_not_available" } : { events: [{ id: "execution-fixture", title: "资料核对完成", summary: "已检查测试中的来源字段", created_at: "2026-10-09T02:08:00Z" }] } });
    if (path === "/api/task-work-orders/dashboard") return route.fulfill({ json: { summary: { tasks: { total: 1, open: 1, blocked: 0 }, work_orders: counts }, by_template: [], tasks: { items: [{ task: businessTask, counts, current_blocking_work_order: null, next_work_order: null }], page: { total: 1, next_cursor: null } }, timezone: "Asia/Shanghai", as_of: "2026-10-09T07:00:00Z" } });
    if (path === `/api/task-work-orders/${BUSINESS_ID}`) {
      const status = options.aggregateStatus || (revoked ? 403 : 200);
      return route.fulfill({ status, json: status === 200 ? aggregate : { error: "aggregate_not_available" } });
    }
    if (path.endsWith("/collaboration-context")) {
      if (options.rootDeniedAfterRelated) revoked = true;
      if (options.relatedDenied || options.rootDeniedAfterRelated) return route.fulfill({ status: 403, json: { error: "restricted_module" } });
      return route.fulfill({ json: { task_id: BUSINESS_ID, risk: "L1", calls_model: false, cursor: 0, has_more: false, version: "v1", gates: [], events: [] } });
    }
    if (path.endsWith("/suggestions")) return route.fulfill({ json: { suggestions: [], calls_model: false } });
    if (path === "/api/sessions") return route.fulfill({ json: [] });
    return route.fulfill({ json: { count: 0, unread: 0, jobs: [], alerts: {}, version: "fixture" } });
  });
  return { reads: () => reads, writes: () => writes, bodies, apiErrors, revoke: () => { revoked = true; } };
}
