import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, ConfigProvider, Drawer, Modal, type ThemeConfig } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import zhCN from "antd/locale/zh_CN";
import "./task-detail-drawer.css";

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

/** Ant tokens adapt DESIGN.md; styles.css remains the sole source of numeric/color values. */
function useProjectAntTheme(): ThemeConfig {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision(value => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setRevision(value => value + 1);
    reducedMotion.addEventListener("change", update);
    return () => { observer.disconnect(); reducedMotion.removeEventListener("change", update); };
  }, []);
  return useMemo(() => {
    if (typeof document === "undefined") return {};
    const computed = getComputedStyle(document.documentElement);
    const value = (name: string) => computed.getPropertyValue(name).trim();
    const number = (name: string) => { const parsed = Number.parseFloat(value(name)); return Number.isFinite(parsed) ? parsed : undefined; };
    return {
      token: {
        fontSize: number("--ds-font-sm"), fontSizeSM: number("--ds-font-xs"), fontSizeLG: number("--ds-font-sm"),
        fontWeightStrong: 600, borderRadius: number("--radius-control"), borderRadiusSM: number("--radius-control"),
        controlHeight: number("--control-h"), controlHeightSM: number("--control-h-sm"),
        colorPrimary: value("--accent"), colorLink: value("--accent-text"), colorText: value("--text"),
        colorTextSecondary: value("--text-quiet"), colorBgContainer: value("--bg"), colorBgElevated: value("--bg"),
        colorTextHeading: value("--text"), colorTextDescription: value("--text-quiet"), colorTextPlaceholder: value("--text-quiet"),
        colorIcon: value("--text-quiet"), colorIconHover: value("--text"), colorFillTertiary: value("--bg-subtle"),
        colorBorder: value("--border"), colorSplit: value("--border"),
        colorSuccess: value("--success"), colorWarning: value("--warning"), colorError: value("--danger"),
        motion: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      components: {
        Button: { colorPrimary: value("--primary"), colorPrimaryHover: value("--primary-hover"), colorTextLightSolid: value("--primary-fg"), fontSize: number("--ds-font-sm"), fontSizeSM: number("--ds-font-sm") },
        Drawer: { fontSizeLG: number("--ds-font-sm"), footerPaddingBlock: number("--space-3"), footerPaddingInline: number("--space-4") },
        Tabs: { titleFontSize: number("--ds-font-sm"), titleFontSizeSM: number("--ds-font-sm"), inkBarColor: value("--accent"), itemSelectedColor: value("--accent-text") },
        Descriptions: { itemPaddingBottom: number("--space-2"), titleMarginBottom: number("--space-2") },
        Form: { itemMarginBottom: number("--space-3"), labelFontSize: number("--ds-font-sm") },
      },
    };
  }, [revision]);
}

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
  const projectTheme = useProjectAntTheme();
  return <ConfigProvider locale={zhCN} componentSize="small" theme={projectTheme}><DrawerShell {...props} /></ConfigProvider>;
}
