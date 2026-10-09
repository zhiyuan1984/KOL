import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import "./task-detail-drawer.css";

type TaskDetailThemeProviderProps = {
  children: ReactNode;
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

/** Scoped task-detail theme for both the drawer and independent task-detail surface. */
export function TaskDetailThemeProvider({ children }: TaskDetailThemeProviderProps) {
  const projectTheme = useProjectAntTheme();
  return <ConfigProvider locale={zhCN} componentSize="small" theme={projectTheme}>{children}</ConfigProvider>;
}
