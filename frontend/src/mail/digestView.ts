import type { MailDigest, MailDigestSource } from "./types";

export type MailDigestKind = "model" | "rule" | "failed" | "empty";

export type MailDigestView = {
  label: string;
  kind: MailDigestKind;
  text: string;
  collapsed: boolean;
  disclaimer?: string;
  lede?: string;
};

const MODEL_SOURCES = new Set<string>(["codex_memory", "luna"]);

export function isModelDigestSource(source?: string | null): boolean {
  return MODEL_SOURCES.has(String(source || ""));
}

export function mailDigestView(digest?: MailDigest | null): MailDigestView {
  const source = String(digest?.source || "") as MailDigestSource | "";
  const text = String(digest?.text || "").trim();
  if (isModelDigestSource(source) && text) {
    return { label: "往来要点", kind: "model", text, collapsed: false };
  }
  if (source === "analysis_failed") {
    const error = String(digest?.error || "").trim();
    return {
      label: error ? `分析未完成 · ${error}` : "分析未完成",
      kind: "failed",
      text: "",
      collapsed: false,
      lede: "未能读完这些正文。点「收取」后可再试。",
    };
  }
  if (source === "body_analysis" || text) {
    return {
      label: "规则摘录",
      kind: "rule",
      text,
      collapsed: true,
      disclaimer: "这不是模型摘要，而是按每封邮件整理的规则摘录。",
    };
  }
  return { label: "", kind: "empty", text: "", collapsed: true };
}

export function bannedModelPretendLabel(): string {
  return "历史邮件往来摘要";
}
