import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Drawer, Modal } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import "./task-detail-drawer.css";
import { TaskDetailThemeProvider } from "./TaskDetailTheme";

type TaskDetailDrawerProps = {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: "detail" | "create-business-task";
  status?: ReactNode;
  dirty?: boolean;
  closeDisabled?: boolean;
  footer?: ReactNode;
};

function DrawerShell({ eyebrow, title, onClose, children, variant = "detail", status, dirty = false, closeDisabled = false, footer }: TaskDetailDrawerProps) {
  const [modal, contextHolder] = Modal.useModal();
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => { origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }, []);
  const close = () => {
    if (closeDisabled) return;
    const finish = () => {
      onClose();
      requestAnimationFrame(() => { if (origin.current?.isConnected) origin.current.focus({ preventScroll: true }); });
    };
    if (!dirty) { finish(); return; }
    modal.confirm({ title: "放弃未提交的内容？", content: "返回任务明细后，当前未提交的内容将不会保存。", okText: "放弃并返回", cancelText: "继续编辑", onOk: finish });
  };
  return <>
    {contextHolder}
    <Drawer open placement="right" rootClassName="task-detail-ant-root" className="task-detail-ant-drawer" size="min(var(--drawer-w-sm), 100vw)"
      title={<div className="task-detail-ant-heading"><div className="task-detail-ant-nav">{variant === "detail" ? <Button icon={<ArrowLeftOutlined />} size="small" onClick={close} disabled={closeDisabled}>返回任务明细</Button> : null}<span className="task-detail-ant-eyebrow">{eyebrow}</span></div><div className="task-detail-ant-object"><strong>{title}</strong>{status}</div></div>}
      closable={{ placement: "end", disabled: closeDisabled, "aria-label": "关闭详情" }} onClose={close} keyboard={!closeDisabled}
      mask={{ closable: !closeDisabled }} focusable={{ trap: true, focusTriggerAfterClose: true }} footer={footer}
      onKeyDown={event => {
        if (event.key !== "Tab" || event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
        const panel = event.target.closest<HTMLElement>('[role="dialog"]');
        const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(node => node.getClientRects().length);
        if (!panel?.closest(".task-detail-ant-root") || dialogs.at(-1) !== panel) return;
        const focusables = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
          .filter(node => node.tabIndex >= 0 && node.getClientRects().length && getComputedStyle(node).visibility !== "hidden");
        const first = focusables[0], last = focusables.at(-1);
        if (first && event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (first && !event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      classNames={{ body: "task-detail-ant-body", header: "task-detail-ant-header", footer: "task-detail-ant-footer" }}>
      <div data-variant={variant} className="task-detail-content" aria-label={eyebrow}>{children}</div>
    </Drawer>
  </>;
}

/** Shared shell retains route/object identity; closing never redirects a session to Home. */
export function TaskDetailDrawer(props: TaskDetailDrawerProps) {
  return <TaskDetailThemeProvider><DrawerShell {...props} /></TaskDetailThemeProvider>;
}
