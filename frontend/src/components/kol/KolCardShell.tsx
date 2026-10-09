import { useLayoutEffect, useRef, useState, type DetailsHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { Checkbox, type CheckboxProps } from "antd";
import KolAction from "./KolCardActions";
import "./kol-card.css";

type DataProps = { [key: `data-${string}`]: string | number | boolean | undefined };
export function KolCardShell({ variant, className = "", ...props }: HTMLAttributes<HTMLElement> & DataProps & { variant: "followed" | "pool" | "discovery" }) {
  return <article {...props} className={`kol-card-row ${className}`} data-kol-unified={variant} />;
}
export function KolCardIdentity({ className = "", ...props }: HTMLAttributes<HTMLDivElement> & DataProps) {
  return <div {...props} className={`kol-card-identity ${className}`} data-kol-layout="identity" />;
}
export function KolCardMeta({ className = "", ...props }: HTMLAttributes<HTMLDivElement> & DataProps) {
  return <div {...props} className={`kol-card-meta ${className}`} data-kol-layout="meta" />;
}
export function KolCardReview({ className = "", ...props }: HTMLAttributes<HTMLDivElement> & DataProps) {
  return <div {...props} className={`kol-card-review ${className}`} data-kol-layout="review" />;
}
export function KolCardActions({ className = "", ...props }: HTMLAttributes<HTMLDivElement> & DataProps) {
  return <div {...props} className={`kol-card-actions ${className}`} data-kol-layout="actions" />;
}
export function KolCardEvidence({ label, children, className = "", ...props }: DetailsHTMLAttributes<HTMLDetailsElement> & DataProps & { label: ReactNode }) {
  return <details {...props} className={`kol-card-evidence ${className}`}><summary>{label}</summary><div className="kol-card-evidence-body">{children}</div></details>;
}
export function KolCardSelection({ className = "", ...props }: CheckboxProps & DataProps) {
  return <Checkbox {...props} className={`kol-card-selection ${className}`} />;
}
/** Only show an expansion affordance when the summary really overflows. */
export function KolCardSummary({ label, text, className = "", ...props }: HTMLAttributes<HTMLDivElement> & DataProps & { label?: string; text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { if (!expanded) setTruncated(el.scrollHeight > el.clientHeight + 1); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, expanded]);
  return <div {...props} className={`kol-card-summary ${className}`}>
    {label ? <span className="kol-card-summary-label">{label}：</span> : null}
    <span ref={ref} className="kol-card-summary-text" data-expanded={expanded || undefined}>{text}</span>
    {truncated || expanded ? <KolAction aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "收起全文" : "展开全文"}</KolAction> : null}
  </div>;
}
