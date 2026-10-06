import type { ReactNode } from "react";

type TaskDetailDrawerProps = {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: "detail" | "create-business-task";
};

/** A single shell keeps system-run and business-task detail interactions identical. */
export function TaskDetailDrawer({ eyebrow, title, onClose, children, variant = "detail" }: TaskDetailDrawerProps) {
  return <div className="task-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="task-detail-drawer" data-variant={variant} role="dialog" aria-modal="true" aria-label={eyebrow}>
      <header><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button type="button" aria-label="关闭详情" onClick={onClose}>×</button></header>
      {children}
    </aside>
  </div>;
}
