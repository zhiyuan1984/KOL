import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { approvalStatusLabel, friendlyError, stripApprovalRecordIds } from "../labels";

type Approval = {
  id: string;
  kind?: string;
  kind_label?: string;
  title?: string;
  brand: string;
  amount_usd: number;
  status: string;
  chain: string[];
  current_index: number;
  wecom_card_id: string;
  need_manual_band: number;
  chain_id?: string;
  can_decide?: boolean;
  expected_role?: string;
  submitted_by?: string;
  payload?: Record<string, unknown>;
  chain_detail: { name: string; role: string }[];
  wecom_card?: { status: string; body: string; assignee: string };
};

type Slice = "mine" | "all" | "done";

function kindLabel(row: Approval) {
  return row.kind_label || ({
    expense: "费用审批",
    stage: "阶段审批",
    content: "内容审核",
    settlement: "结算审批",
  }[row.kind || "expense"] || "审批");
}

function formatAmount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return n.toLocaleString("zh-CN");
}

function moneyLine(row: Approval) {
  if (row.kind && row.kind !== "expense") {
    return row.title || String(row.payload?.reason || "确认阶段");
  }
  const payload = row.payload || {};
  const currency = String(payload.currency || "CNY");
  const amount = payload.amount;
  const base = payload.amount_base ?? row.amount_usd;
  const requester = payload.requester_name ? `${payload.requester_name}申请` : "费用申请";
  if (currency !== "CNY" && amount != null && amount !== "") {
    return `${requester} ${currency} ${formatAmount(amount)}，折合人民币 ${formatAmount(base)}`;
  }
  return `${requester} 人民币 ${formatAmount(base)}`;
}

function pathState(row: Approval, index: number): "done" | "current" | "rejected" | "todo" {
  if (row.status === "consumed" || row.status === "sent") return "done";
  if (row.status === "rejected") {
    if (index < row.current_index) return "done";
    if (index === row.current_index) return "rejected";
    return "todo";
  }
  if (index < row.current_index) return "done";
  if (index === row.current_index) return "current";
  return "todo";
}

function waitingName(row: Approval) {
  return row.chain_detail?.[row.current_index]?.name || "下一位审批人";
}

export default function Approvals() {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get("id") || "";
  const [rows, setRows] = useState<Approval[]>([]);
  const [cards, setCards] = useState<{ approval_id: string; body: string; status: string; assignee: string }[]>([]);
  const [err, setErr] = useState("");
  const [slice, setSlice] = useState<Slice>("mine");

  const load = () => {
    api.approvals().then((r) => setRows(r as Approval[]));
    api.wecomCards().then((r) => setCards(r as never));
  };
  useEffect(load, []);

  const act = async (id: string, decision: string, actor: string) => {
    setErr("");
    try {
      const result = await api.decide(id, decision, actor) as { detail?: string };
      if (result && typeof result === "object" && "detail" in result && result.detail) {
        throw new Error(String(result.detail));
      }
      load();
    } catch (e) {
      setErr(friendlyError(e, "审批未完成，请稍后重试"));
    }
  };

  useEffect(() => {
    if (!focusId || !rows.length) return;
    const target = rows.find((row) => row.id === focusId);
    if (!target) return;
    if (target.status !== "pending") setSlice("done");
    else if (target.can_decide === false) setSlice("all");
    else setSlice("mine");
  }, [focusId, rows]);

  const visible = useMemo(() => {
    const focused = focusId ? rows.find((row) => row.id === focusId) : undefined;
    let list: Approval[];
    if (slice === "done") list = rows.filter((row) => row.status !== "pending");
    else {
      const pending = rows.filter((row) => row.status === "pending");
      list = slice === "mine" ? pending.filter((row) => row.can_decide !== false) : pending;
    }
    if (focused && !list.some((row) => row.id === focused.id)) list = [focused, ...list];
    return list;
  }, [rows, slice, focusId]);

  useEffect(() => {
    if (!focusId) return;
    const node = document.querySelector(`[data-approval-id="${CSS.escape(focusId)}"]`);
    node?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusId, visible]);

  return (
    <div className="list-page approval-page">
      <div>
        <div className="page-kicker">审批</div>
        <h1 style={{ marginTop: 0 }}>工作审批</h1>
        <p className="muted">费用按规则一位通过再到下一位。最后一位同意即办结；任一位驳回则整单作废。「待我处理」只列出轮到你确认的单；还没轮到时可在「待处理」查看。</p>
      </div>
      <div className="task-filters" aria-label="筛选审批">
        {([["mine", "待我处理"], ["all", "待处理"], ["done", "已结束"]] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={slice === id} onClick={() => setSlice(id)} data-approval-slice={id}>
            {label} {id === "mine"
              ? rows.filter((row) => row.status === "pending" && row.can_decide !== false).length
              : id === "all"
                ? rows.filter((row) => row.status === "pending").length
                : rows.filter((row) => row.status !== "pending").length}
          </button>
        ))}
      </div>
      {err && <p className="error">{err}</p>}
      {visible.length === 0 && <p className="muted">这个筛选下暂无审批。</p>}
      {visible.map((a) => {
        const current = waitingName(a);
        const notice = stripApprovalRecordIds(a.wecom_card?.body);
        const rule = String(a.payload?.rule_id || "");
        return (
          <div
            className={"panel approval-card" + (a.status === "pending" ? " is-pending" : "") + (focusId === a.id ? " is-focus" : "")}
            key={a.id}
            data-approval-id={a.id}
            data-approval-kind={a.kind || "expense"}
            data-approval-status={a.status}
            data-approval-focus={focusId === a.id ? "true" : undefined}
          >
            <h3 className="approval-title">
              <span className="remote-pill sm" data-remote="business-approve-agent">{kindLabel(a)}</span>
              <span>{moneyLine(a)}</span>
              <span className="nowrap">{approvalStatusLabel(a.status)}</span>
            </h3>
            <p className="muted">
              {rule ? `适用 ${rule}` : ""}
              {a.need_manual_band ? " · 需人工确认金额档" : ""}
              {a.status === "pending" ? ` · 当前等待 ${current}（第 ${a.current_index + 1}/${a.chain_detail?.length || a.chain.length} 人）` : ""}
            </p>
            <ol className="approval-path" data-approval-path>
              {(a.chain_detail || []).map((step, index) => (
                <li key={`${step.name}-${index}`} data-path-state={pathState(a, index)}>
                  <span>{step.name}</span>
                  <small>{step.role}</small>
                </li>
              ))}
            </ol>
            {notice && <p className="muted" data-approval-notice>{notice}</p>}
            {a.status === "pending" && a.can_decide !== false && (
              <div className="panel actions" style={{ border: 0, boxShadow: "none", padding: 0 }}>
                <button className="btn work" onClick={() => act(a.id, "approve", a.chain[a.current_index])}>
                  同意
                </button>
                <button className="btn danger" onClick={() => act(a.id, "reject", a.chain[a.current_index])}>
                  驳回
                </button>
              </div>
            )}
            {a.status === "pending" && a.can_decide === false && (
              <p className="muted">当前等待 {current}。你可以查看进度，但这一步不由你确认。</p>
            )}
          </div>
        );
      })}
      <div className="panel">
        <h3>审批通知</h3>
        {cards.length === 0 && <p className="muted">暂无通知。</p>}
        {cards.map((c) => (
          <p key={c.approval_id} className="muted">
            [{approvalStatusLabel(c.status)}] {c.assignee} · {stripApprovalRecordIds(c.body)}
          </p>
        ))}
      </div>
    </div>
  );
}
