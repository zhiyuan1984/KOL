import { useEffect, useState, type ReactNode } from "react";
import { ConfigProvider, theme, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";

/** Read the registered CSS values rather than create a second palette/size source. */
function taskTheme(): ThemeConfig {
  if (typeof document === "undefined") return {};
  const css = getComputedStyle(document.documentElement);
  const value = (name: string) => css.getPropertyValue(name).trim();
  const color = (name: string) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const srgb = resolved.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    return srgb ? `rgb(${srgb.slice(1, 4).map(channel => Math.round(Number(channel) * 255)).join(", ")})` : resolved;
  };
  const number = (name: string) => Number.parseFloat(value(name));
  return {
    algorithm: theme.compactAlgorithm,
    token: {
      colorPrimary: color("--accent-text"), colorLink: color("--accent-text"),
      colorText: color("--text"), colorTextSecondary: color("--text-quiet"),
      colorBgContainer: color("--bg"), colorBgElevated: color("--bg"),
      colorBorder: color("--control-border"), colorBorderSecondary: color("--border"),
      colorError: color("--danger-text"), colorWarning: color("--warning-text"), colorSuccess: color("--success"),
      fontSize: number("--ds-font-sm"), fontSizeSM: number("--ds-font-xs"),
      fontFamily: value("--font-openai-sans"), borderRadius: number("--radius-control"),
      controlHeight: number("--control-h-lg"), controlHeightSM: number("--control-h-sm"),
      motion: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    },
    components: {
      Button: { controlHeight: number("--control-h-sm"), contentFontSize: number("--ds-font-sm"), paddingInline: number("--space-1") },
      Input: { controlHeight: number("--control-h-lg"), paddingBlock: 0, paddingInline: number("--space-2") },
      Select: { controlHeight: number("--control-h-lg"), optionFontSize: number("--ds-font-sm") },
      DatePicker: { controlHeight: number("--control-h-lg"), cellActiveWithRangeBg: color("--bg-subtle"), cellHoverBg: color("--bg-subtle") },
      Pagination: { itemSize: number("--control-h-sm"), itemSizeSM: number("--control-h-sm"), fontSize: number("--ds-font-sm") },
    },
  };
}

export function TaskTheme({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ThemeConfig>(() => taskTheme());
  useEffect(() => {
    const update = () => setConfig(taskTheme());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced.addEventListener("change", update);
    return () => { observer.disconnect(); reduced.removeEventListener("change", update); };
  }, []);
  return <ConfigProvider locale={zhCN} theme={config}>{children}</ConfigProvider>;
}
