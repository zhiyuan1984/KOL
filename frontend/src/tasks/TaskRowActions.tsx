import type { ReactNode } from "react";
import { Button } from "antd";
import { DownOutlined, UpOutlined } from "@ant-design/icons";

type TaskRowActionsProps = {
  detail: ReactNode;
  secondary?: ReactNode;
  expanded: boolean;
  label: string;
  onToggle: () => void;
  busy?: boolean;
};

/** Stable slots prevent conditional session/cancel actions from moving the fold control. */
export function TaskRowActions({ detail, secondary, expanded, label, onToggle, busy = false }: TaskRowActionsProps) {
  return <div className="task-center-actions">
    <div className="task-center-detail-slot">{detail}</div>
    <div className="task-center-secondary-slot">
      {secondary || <Button className="task-center-action-placeholder" type="text" size="small" disabled aria-hidden="true" tabIndex={-1}>占位</Button>}
    </div>
    <Button className="task-center-fold" type="text" size="small" aria-label={label} aria-expanded={expanded} aria-busy={busy || undefined} disabled={busy} onClick={onToggle} icon={expanded ? <UpOutlined /> : <DownOutlined />} />
  </div>;
}
