import type { ReactNode } from "react";
import { Button, Dropdown } from "antd";
import { DownOutlined, EllipsisOutlined, UpOutlined } from "@ant-design/icons";

type TaskRowActionsProps = {
  detail: ReactNode;
  secondary?: ReactNode;
  expanded: boolean;
  label: string;
  onToggle: () => void;
  busy?: boolean;
};

/** Stable desktop slots; narrow containers keep secondary actions available in More. */
export function TaskRowActions({ detail, secondary, expanded, label, onToggle, busy = false }: TaskRowActionsProps) {
  return <div className="task-center-actions">
    <div className="task-center-detail-slot">{detail}</div>
    <div className="task-center-secondary-slot">
      {secondary || <Button className="task-center-action-placeholder" type="text" size="small" disabled aria-hidden="true" tabIndex={-1}>占位</Button>}
    </div>
    {secondary ? <Dropdown trigger={["click"]} popupRender={() => <div className="task-row-more-popup" role="group" aria-label="任务操作">{secondary}</div>}>
      <Button className="task-center-more" type="text" size="small" aria-label={`${label.replace(/^(展开|收起)/, "")}更多操作`} icon={<EllipsisOutlined />} />
    </Dropdown> : <span className="task-center-more task-center-more-placeholder" aria-hidden="true" />}
    <Button className="task-center-fold" type="text" size="small" aria-label={label} aria-expanded={expanded} aria-busy={busy || undefined} disabled={busy} onClick={onToggle} icon={expanded ? <UpOutlined /> : <DownOutlined />} />
  </div>;
}
