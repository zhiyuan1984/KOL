import { useEffect, useRef, useState } from "react";
import type { AiTaskWorkOrderAggregate, AiWorkOrderSummary, Task } from "../api";
import { taskPriorityLabel } from "../home/homeModel";
import "./task-expanded-details.css";

export type DetailFact = { label: string; value: string };
const clean = (value: unknown) => value == null ? "" : String(value).trim();
const hasContent = (value: unknown) => Boolean(clean(value) && !["—", "暂无任务历史", "暂无开放工单"].includes(clean(value)));
const comparable = (value: unknown) => clean(value).replace(/\s+/g, "");
export function detailTime(value: unknown): string {
  const text = clean(value);
  if (!text) return "";
  const date = new Date(text);
  return Number.isNaN(date.valueOf()) ? text : date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function usefulSummary(value: unknown, title: string): string {
  return hasContent(value) && comparable(value) !== comparable(title) ? clean(value) : "";
}
const priority = (task: { priority?: string; priority_label?: string }) => taskPriorityLabel(task) || clean(task.priority_label || task.priority);
const fact = (label: string, value: unknown): DetailFact[] => hasContent(value) ? [{ label, value: clean(value) }] : [];
export function agentDetailFacts(task: Task): DetailFact[] {
  const skill = task.skill || task.skill_id;
  return [
    ...fact(skill ? "技能" : "来源", skill || task.task_type || task.source),
    ...fact("创建", detailTime(task.created_at)),
    ...fact("开始", detailTime(task.started_at)),
    ...fact("优先级", priority(task)),
    ...fact("截止", detailTime(task.due_at)),
  ];
}
export function businessDetailFacts(detail: AiTaskWorkOrderAggregate): DetailFact[] {
  const counts = detail.counts;
  const count = detail.work_orders.length ? counts.total : 0;
  const orders = count ? `${count}${counts.open ? ` · 开放 ${counts.open}` : ""}${counts.blocked ? ` · 阻塞 ${counts.blocked}` : ""}${counts.waiting_review ? ` · 待复核 ${counts.waiting_review}` : ""}` : "无";
  return [
    ...fact("创建", detailTime(detail.task.created_at)),
    ...fact("优先级", priority(detail.task)),
    ...fact("截止", detailTime(detail.task.due_at)),
    { label: "工单", value: orders },
  ];
}

function DetailSummary({ label, value }: { label: string; value: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const element = textRef.current;
    if (!element) return;
    const measure = () => { if (!expanded) setOverflow(element.scrollWidth > element.clientWidth + 1); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value, expanded]);
  return <div className="task-expanded-summary" data-summary-open={expanded}>
    <span className="task-expanded-label">{label}</span>
    <span ref={textRef} className="task-expanded-summary-text">{value}</span>
    {overflow || expanded ? <button type="button" className="task-expanded-full-text" aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? "收起全文" : "展开全文"}</button> : null}
  </div>;
}
function DetailFacts({ facts }: { facts: DetailFact[] }) {
  return facts.length ? <dl className="task-expanded-facts">{facts.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : null;
}
function WorkOrderRows({ orders, statusLabel, decisionSummary }: { orders: AiWorkOrderSummary[]; statusLabel: (status: string) => string; decisionSummary: (order: AiWorkOrderSummary) => string }) {
  return <div className="task-expanded-orders-wrap"><table className="task-expanded-orders" aria-label="标准工单明细">
    <colgroup><col /><col className="task-expanded-order-status-col" /><col className="task-expanded-order-owner-col" /><col className="task-expanded-order-decision-col" /></colgroup>
    <thead><tr><th scope="col">标准工单</th><th scope="col">状态</th><th scope="col">主受理</th><th scope="col">决策摘要</th></tr></thead>
    <tbody>{orders.map(order => <tr key={order.work_order_id}>
      <td><span className="task-expanded-order-title" title={`${order.title} · ${order.template_code}.v${order.template_version}`}>{order.title}</span></td>
      <td><span title={statusLabel(order.status)}>{statusLabel(order.status)}</span></td>
      <td><span title={order.primary_assignee?.person_ref || "未分派"}>{order.primary_assignee?.person_ref || "未分派"}</span></td>
      <td><span title={order.latest_decision ? decisionSummary(order) : "—"}>{order.latest_decision ? decisionSummary(order) : "—"}</span></td>
    </tr>)}</tbody>
  </table></div>;
}
export function AgentExpandedDetails({ task, title, summary }: { task: Task; title: string; summary: string }) {
  const value = usefulSummary(summary, title);
  const facts = agentDetailFacts(task);
  return <div className="task-expanded-details" data-detail-kind="agent">
    {value ? <DetailSummary label="摘要" value={value} /> : null}
    <DetailFacts facts={facts} />
    {!value && !facts.length ? <span className="task-expanded-empty">暂无补充信息</span> : null}
  </div>;
}
export function BusinessExpandedDetails({ detail, statusLabel, decisionSummary }: { detail: AiTaskWorkOrderAggregate; statusLabel: (status: string) => string; decisionSummary: (order: AiWorkOrderSummary) => string }) {
  const goal = usefulSummary(detail.task.goal, detail.task.title);
  const blocker = detail.current_blocking_work_order;
  return <div className="task-expanded-details" data-detail-kind="business">
    {goal ? <DetailSummary label="目标" value={goal} /> : null}
    {blocker ? <DetailSummary label="阻塞" value={blocker.title} /> : null}
    <DetailFacts facts={businessDetailFacts(detail)} />
    {detail.work_orders.length ? <WorkOrderRows orders={detail.work_orders} statusLabel={statusLabel} decisionSummary={decisionSummary} /> : null}
  </div>;
}
