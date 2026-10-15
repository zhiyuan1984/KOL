import { Badge } from "antd";
import "./approval-nav-badge.css";

export function ApprovalNavBadge({ count, error = "", collapsed = false }: { count?: number; error?: string; collapsed?: boolean }) {
  if (!(count && count > 0) && !error) return null;
  return <Badge
    className="approval-nav-badge"
    data-approval-count={count}
    data-approval-stale={error ? true : undefined}
    count={count && count > 0 ? count : "!"}
    dot={collapsed && Boolean(count && count > 0)}
    overflowCount={99}
    color="var(--warning-text)"
    size="small"
    title=""
    aria-hidden="true"
  />;
}
