import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";

/** Scoped adapter: DESIGN.md and styles.css are the only token authorities. */
export default function CronTheme({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", update);
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);
  const theme = useMemo<ThemeConfig>(() => {
    const tokens = getComputedStyle(document.documentElement);
    const value = (name: string) => tokens.getPropertyValue(name).trim();
    const number = (name: string) => Number.parseFloat(value(name)) || undefined;
    return {
      token: {
        fontSize: number("--ds-font-sm"), fontSizeSM: number("--ds-font-xs"), fontSizeLG: number("--ds-font-sm"),
        fontFamily: tokens.fontFamily, borderRadius: number("--radius-control"), controlHeight: number("--control-h"),
        controlHeightSM: number("--control-h-sm"), controlHeightLG: number("--control-h-lg"),
        colorPrimary: value("--accent"), colorLink: value("--accent-text"), colorText: value("--text"),
        colorTextSecondary: value("--text-quiet"), colorTextPlaceholder: value("--text-quiet"),
        colorBgContainer: value("--bg"), colorBgElevated: value("--bg"), colorBorder: value("--border"),
        colorSplit: value("--border"), colorFillTertiary: value("--bg-subtle"),
        colorSuccess: value("--success"), colorWarning: value("--warning"), colorError: value("--danger"),
        motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      components: {
        Button: { colorPrimary: value("--primary"), colorPrimaryHover: value("--primary-hover"), colorTextLightSolid: value("--primary-fg"), fontSize: number("--ds-font-sm"), fontSizeSM: number("--ds-font-sm") },
        Tabs: { titleFontSize: number("--ds-font-sm"), titleFontSizeSM: number("--ds-font-sm"), inkBarColor: value("--accent"), itemSelectedColor: value("--accent-text") },
        Table: { cellFontSizeSM: number("--ds-font-sm"), cellPaddingBlockSM: 0, cellPaddingInlineSM: number("--space-2"), headerBg: value("--bg-subtle"), borderColor: value("--border"), rowHoverBg: value("--bg-subtle") },
        Drawer: { fontSizeLG: number("--ds-font-sm"), footerPaddingBlock: number("--space-3"), footerPaddingInline: number("--space-4") },
      },
    };
  }, [revision]);
  return <ConfigProvider locale={zhCN} componentSize="small" theme={theme}>{children}</ConfigProvider>;
}
