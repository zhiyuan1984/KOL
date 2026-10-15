import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider, theme, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";

/**
 * Scoped Ant Design adapter for project surfaces. CSS variables in styles.css remain
 * the single visual authority; this only lets mature AntD controls consume them.
 */
function projectTheme(): ThemeConfig {
  if (typeof document === "undefined") return {};
  const css = getComputedStyle(document.documentElement);
  const value = (name: string) => css.getPropertyValue(name).trim();
  const number = (name: string) => Number.parseFloat(value(name)) || undefined;
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    algorithm: theme.compactAlgorithm,
    token: {
      fontSize: number("--ds-font-sm"),
      fontSizeSM: number("--ds-font-xs"),
      fontSizeLG: number("--ds-font-sm"),
      fontFamily: value("--font-openai-sans") || css.fontFamily,
      borderRadius: number("--radius-control"),
      controlHeight: number("--control-h"),
      controlHeightSM: number("--control-h-sm"),
      controlHeightLG: number("--control-h-lg"),
      colorPrimary: value("--accent"),
      colorLink: value("--accent-text"),
      colorText: value("--text"),
      colorTextSecondary: value("--text-quiet"),
      colorTextPlaceholder: value("--text-quiet"),
      colorBgContainer: value("--bg"),
      colorBgElevated: value("--bg"),
      colorBorder: value("--border"),
      colorSplit: value("--border"),
      colorFillTertiary: value("--bg-subtle"),
      colorSuccess: value("--success"),
      colorWarning: value("--warning"),
      colorError: value("--danger"),
      motion: !reducedMotion,
    },
    components: {
      Button: {
        colorPrimary: value("--primary"),
        colorPrimaryHover: value("--primary-hover"),
        colorTextLightSolid: value("--primary-fg"),
        fontSize: number("--ds-font-sm"),
        fontSizeSM: number("--ds-font-sm"),
      },
      Tabs: {
        titleFontSize: number("--ds-font-sm"),
        titleFontSizeSM: number("--ds-font-sm"),
        inkBarColor: value("--accent"),
        itemSelectedColor: value("--accent-text"),
      },
      Progress: { defaultColor: value("--accent") },
    },
  };
}

export function ProjectTheme({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision((current) => current + 1);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.addEventListener("change", update);
    return () => {
      observer.disconnect();
      reduced.removeEventListener("change", update);
    };
  }, []);
  const config = useMemo(projectTheme, [revision]);
  return <ConfigProvider locale={zhCN} componentSize="small" theme={config}>{children}</ConfigProvider>;
}
