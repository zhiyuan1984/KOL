import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button, Form, Popover, type FormProps } from 'antd';
import './information-layout.css';

export type PropertyItem = { key: string; label: ReactNode; value: ReactNode; emptyText?: ReactNode };
export function PropertyList({ items, className = '', labelWidth = 'default', ...props }: HTMLAttributes<HTMLDListElement> & { items: PropertyItem[]; labelWidth?: 'short' | 'default' | 'long' }) {
  return <dl {...props} className={`ui-properties ui-label-${labelWidth} ${className}`}>
    {items.map(item => <div className="ui-property-row" data-property={item.key} key={item.key}>
      <dt>{item.label}</dt><dd>{item.value === null || item.value === undefined || item.value === '' ? item.emptyText ?? '未登记' : item.value}</dd>
    </div>)}
  </dl>;
}

/** A single column of fields; layout follows the actual container, not the viewport. */
export function HorizontalForm({ children, className = '', labelWidth = 'default', ...props }: Omit<FormProps, 'children'> & { children?: ReactNode; labelWidth?: 'short' | 'default' | 'long' }) {
  const form = <Form {...props} layout="horizontal" labelAlign="left" labelWrap colon={false} className={`ui-horizontal-form ${className}`}>{children}</Form>;
  return <div className={`ui-form-container ui-label-${labelWidth}`}>{props.component === false ? <div className={`ui-horizontal-form ${className}`}>{form}</div> : form}</div>;
}

export function RecordRow({ title, meta, status, actions, detail, className = '', ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & { title: ReactNode; meta?: ReactNode; status?: ReactNode; actions?: ReactNode; detail?: ReactNode }) {
  return <div {...props} className={`ui-record-row ${className}`}>
    <div className="ui-record-main"><div className="ui-record-title">{title}</div>{meta !== undefined && <div className="ui-record-meta">{meta}</div>}</div>
    {status !== undefined && <div className="ui-record-status">{status}</div>}
    {actions !== undefined && <div className="ui-record-actions">{actions}</div>}
    {detail !== undefined && <div className="ui-record-detail">{detail}</div>}
  </div>;
}

export function ActionGroup({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`ui-action-group ${className}`} />;
}

/** Truncated text is still readable by keyboard/touch. It is not a hover-only tooltip. */
export function TruncatableText({ text, className = '' }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = ref.current; if (!element) return;
    const check = () => setOverflow(element.scrollWidth > element.clientWidth + 1);
    check(); const observer = new ResizeObserver(check); observer.observe(element);
    return () => observer.disconnect();
  }, [text]);
  return <span className={`ui-truncatable ${className}`}><span ref={ref} className="ui-truncatable-value" title={text}>{text}</span>{overflow && <Popover trigger="click" placement="bottomLeft" content={<div className="ui-full-text">{text}</div>}><Button type="text" size="small" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} aria-label={`查看完整标题：${text}`}>展开</Button></Popover>}</span>;
}
