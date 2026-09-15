import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAccount } from "../components/AuthGate";
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
type Decision = "approve" | "reject";

type Preview = {
  steps: { name: string; role: string }[];
  plan?: { rule_id?: string; amount_base?: number; currency?: string; amount?: number };
};

type PendingConfirm = {
  id: string;
  decision: Decision;
  actor: string;
};

type SessionReceipt = {
  id: string;
  decision: Decision;
  text: string;
  tone: "ok" | "danger";
};

const CURRENCIES = [
  ["CNY", "人民币"],
  ["USD", "美元"],
  ["EUR", "欧元"],
  ["GBP", "英镑"],
  ["JPY", "日元"],
  ["AUD", "澳元"],
  ["CAD", "加元"],
  ["HKD", "港币"],
] as const;

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

function isFinalStep(row: Approval) {
  return row.current_index >= (row.chain_detail?.length || row.chain.length) - 1;
}

function rejectReasonOf(row: Approval): string {
  return String(row.payload?.reject_reason || "").trim();
}

function durableReceipt(row: Approval, session?: SessionReceipt | null): { text: string; tone: "ok" | "danger" | "info" } | null {
  if (session && session.id === row.id) return { text: session.text, tone: session.tone };
  const notice = stripApprovalRecordIds(row.wecom_card?.body);
  const reason = rejectReasonOf(row);
  if (row.status === "rejected") {
    return {
      text: reason ? `已驳回，本单已作废。原因：${reason}` : notice || "已驳回，本单已作废。",
      tone: "danger",
    };
  }
  if (row.status === "consumed" || row.status === "sent") {
    return { text: notice || "已同意，本单已办结。", tone: "ok" };
  }
  if (row.status === "pending" && row.current_index > 0 && notice) {
    return { text: notice, tone: "ok" };
  }
  return null;
}

function consequenceCopy(row: Approval, decision: Decision): string {
  if (decision === "reject") {
    return "驳回后整单作废，不能再同意。";
  }
  if (isFinalStep(row)) {
    return row.kind && row.kind !== "expense"
      ? "你是最后一位。同意后本单办结，并写入已确认的阶段。"
      : "你是最后一位。同意后本单办结。";
  }
  const next = row.chain_detail?.[row.current_index + 1]?.name || "下一位审批人";
  return `同意后，审批交给下一位「${next}」。本单不会办结。`;
}

function receiptCopy(row: Approval, decision: Decision, result: Record<string, unknown>, reason: string): SessionReceipt {
  if (decision === "reject") {
    return {
      id: row.id,
      decision,
      tone: "danger",
      text: `已驳回，本单已作废。原因：${reason}`,
    };
  }
  if (result.status === "consumed" || result.status === "sent") {
    return { id: row.id, decision, tone: "ok", text: "已同意，本单已办结。" };
  }
  const next = (result.chain_detail as { name: string }[] | undefined)?.[Number(result.current_index)]?.name
    || row.chain_detail?.[row.current_index + 1]?.name
    || "下一位审批人";
  return { id: row.id, decision, tone: "ok", text: `已同意。下一任：${next}。` };
}

function InitiateExpenseForm({ onCreated }: { onCreated: (id: string) => void }) {
  const { account } = useAccount();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [requester, setRequester] = useState("");
  const [purpose, setPurpose] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState("");

  const payload = () => ({
    kind: "expense" as const,
    amount: Number(amount),
    currency,
    ...(requester.trim() ? { requester_name: requester.trim() } : {}),
    ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
  });

  const runPreview = async () => {
    if (!amount || Number(amount) <= 0) {
      setPreview(null);
      return;
    }
    try {
      const result = await api.previewApproval(payload());
      setPreview(result);
      setFormErr("");
    } catch (e) {
      setPreview(null);
      setFormErr(friendlyError(e, "还无法计算审批路径"));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormErr("");
    if (!amount || Number(amount) <= 0) {
      setFormErr("请填写金额");
      return;
    }
    setBusy(true);
    try {
      if (!preview) {
        const result = await api.previewApproval(payload());
        setPreview(result);
      }
      const created = await api.createApproval(payload());
      setAmount("");
      setPurpose("");
      setPreview(null);
      onCreated(String(created.id));
    } catch (e) {
      setFormErr(friendlyError(e, "费用审批未提交，请稍后重试"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel approval-initiate" data-approval-initiate onSubmit={(event) => void submit(event)}>
      <h2>发起费用审批</h2>
      <p className="muted">填写金额和币种后，系统按规则算出审批人。阶段变更请在合作确认里提交，不要写在这里。</p>
      <div className="approval-initiate-grid">
        <label className="field">
          金额
          <input
            name="amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => void runPreview()}
            placeholder="例如 5000"
            required
          />
        </label>
        <label className="field">
          币种
          <select
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
            onBlur={() => void runPreview()}
          >
            {CURRENCIES.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          申请人
          <input
            name="requester"
            value={requester}
            onChange={(event) => setRequester(event.target.value)}
            onBlur={() => void runPreview()}
            placeholder={account?.name ? `默认 ${account.name}` : "默认当前登录人"}
            autoComplete="name"
          />
        </label>
        <label className="field">
          用途
          <input
            name="purpose"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="可选"
          />
        </label>
      </div>
      {preview && preview.steps.length > 0 && (
        <div data-approval-preview>
          <p className="muted">
            {preview.plan?.rule_id ? `将按 ${preview.plan.rule_id} 提交。` : "将按费用规则提交。"}
            审批链如下，确认后提交。
          </p>
          <ol className="approval-path">
            {preview.steps.map((step, index) => (
              <li key={`${step.name}-${index}`} data-path-state={index === 0 ? "current" : "todo"}>
                <span>{step.name}</span>
                <small>{step.role}</small>
              </li>
            ))}
          </ol>
        </div>
      )}
      {formErr && <p className="error" role="alert">{formErr}</p>}
      <button className="btn work" type="submit" disabled={busy}>
        {busy ? "提交中…" : "提交费用审批"}
      </button>
    </form>
  );
}

export default function Approvals() {
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("id") || "";
  const [rows, setRows] = useState<Approval[]>([]);
  const [cards, setCards] = useState<{ approval_id: string; body: string; status: string; assignee: string }[]>([]);
  const [err, setErr] = useState("");
  const [slice, setSlice] = useState<Slice>("mine");
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipts, setReceipts] = useState<Record<string, SessionReceipt>>({});
  const confirmRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const load = () => {
    api.approvals().then((r) => setRows(r as Approval[]));
    api.wecomCards().then((r) => setCards(r as never));
  };
  useEffect(load, []);

  const closeConfirm = () => {
    setPending(null);
    setRejectReason("");
    queueMicrotask(() => triggerRef.current?.focus());
  };

  const act = async () => {
    if (!pending) return;
    const row = rows.find((item) => item.id === pending.id);
    if (!row) return;
    const reason = rejectReason.trim();
    if (pending.decision === "reject" && !reason) {
      setErr("驳回必须填写原因");
      confirmRef.current?.querySelector<HTMLTextAreaElement>("[name='reject_reason']")?.focus();
      return;
    }
    setErr("");
    setBusy(true);
    try {
      const result = await api.decide(
        pending.id,
        pending.decision,
        pending.actor,
        pending.decision === "reject" ? reason : undefined,
      );
      const receipt = receiptCopy(row, pending.decision, result, reason);
      setReceipts((prev) => ({ ...prev, [row.id]: receipt }));
      setSearchParams({ id: row.id });
      setPending(null);
      setRejectReason("");
      load();
    } catch (e) {
      setErr(friendlyError(e, "审批未完成，请稍后重试"));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!pending) return;
    const root = confirmRef.current;
    root?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    const target = pending.decision === "reject"
      ? root?.querySelector<HTMLElement>("[name='reject_reason']")
      : root?.querySelector<HTMLElement>("[data-approval-confirm-yes]");
    target?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) closeConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending, busy]);

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
      const pendingRows = rows.filter((row) => row.status === "pending");
      list = slice === "mine" ? pendingRows.filter((row) => row.can_decide !== false) : pendingRows;
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
    <div className="list-page approval-page" data-visual="docs20">
      <header className="approval-page-head">
        <div className="page-kicker">审批</div>
        <h1>工作审批</h1>
        <p className="muted">费用按规则一位通过再到下一位。最后一位同意即办结；任一位驳回则整单作废。「待我处理」只列出轮到你确认的单；还没轮到时可在「待处理」查看。</p>
      </header>
      <InitiateExpenseForm
        onCreated={(id) => {
          setErr("");
          setSearchParams({ id });
          load();
        }}
      />
      <div className="task-filters approval-filters" aria-label="筛选审批">
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
      {err && <p className="error" role="alert">{err}</p>}
      {visible.length === 0 && <p className="muted">这个筛选下暂无审批。</p>}
      {visible.map((a) => {
        const current = waitingName(a);
        const notice = stripApprovalRecordIds(a.wecom_card?.body);
        const rule = String(a.payload?.rule_id || "");
        const receipt = durableReceipt(a, receipts[a.id]);
        const confirming = pending?.id === a.id;
        return (
          <article
            className={"panel approval-card" + (a.status === "pending" ? " is-pending" : "") + (focusId === a.id ? " is-focus" : "")}
            key={a.id}
            data-approval-id={a.id}
            data-approval-kind={a.kind || "expense"}
            data-approval-status={a.status}
            data-approval-focus={focusId === a.id ? "true" : undefined}
          >
            <h3 className="approval-title">
              <span className="approval-kind">{kindLabel(a)}</span>
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
            {notice && !receipt && <p className="muted" data-approval-notice>{notice}</p>}
            {receipt && (
              <p
                className="approval-receipt"
                data-approval-receipt
                data-tone={receipt.tone}
                role="status"
              >
                {receipt.text}
              </p>
            )}
            {a.status === "pending" && a.can_decide !== false && !confirming && (
              <div className="approval-actions">
                <button
                  type="button"
                  className="btn work"
                  onClick={(event) => {
                    triggerRef.current = event.currentTarget;
                    setErr("");
                    setRejectReason("");
                    setPending({ id: a.id, decision: "approve", actor: a.chain[a.current_index] });
                  }}
                >
                  同意
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={(event) => {
                    triggerRef.current = event.currentTarget;
                    setErr("");
                    setRejectReason("");
                    setPending({ id: a.id, decision: "reject", actor: a.chain[a.current_index] });
                  }}
                >
                  驳回
                </button>
              </div>
            )}
            {confirming && (
              <div
                className="approval-confirm"
                ref={confirmRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`approval-confirm-${a.id}`}
                data-approval-confirm
                data-approval-confirm-decision={pending.decision}
                aria-busy={busy || undefined}
              >
                <strong id={`approval-confirm-${a.id}`}>
                  {pending.decision === "reject" ? "确认驳回？" : "确认同意？"}
                </strong>
                <p data-approval-confirm-object>对象：{moneyLine(a)}</p>
                <p data-approval-confirm-scope>
                  范围：当前等待 {current}（第 {a.current_index + 1}/{a.chain_detail?.length || a.chain.length} 人）
                  {rule ? ` · 适用 ${rule}` : ""}
                </p>
                <p data-approval-confirm-consequence>{consequenceCopy(a, pending.decision)}</p>
                {pending.decision === "reject" && (
                  <label className="field">
                    驳回原因
                    <textarea
                      name="reject_reason"
                      value={rejectReason}
                      onChange={(event) => setRejectReason(event.target.value)}
                      rows={3}
                      required
                      disabled={busy}
                      placeholder="说明为什么驳回"
                    />
                  </label>
                )}
                <div className="approval-actions">
                  <button
                    type="button"
                    className={pending.decision === "reject" ? "btn danger" : "btn work"}
                    data-approval-confirm-yes
                    disabled={busy || (pending.decision === "reject" && !rejectReason.trim())}
                    onClick={() => void act()}
                  >
                    {busy ? "处理中…" : pending.decision === "reject" ? "确认驳回" : "确认同意"}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    data-approval-confirm-no
                    disabled={busy}
                    onClick={closeConfirm}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            {a.status === "pending" && a.can_decide === false && (
              <p className="muted">当前等待 {current}。你可以查看进度，但这一步不由你确认。</p>
            )}
          </article>
        );
      })}
      <section className="panel approval-notices">
        <h3>审批通知</h3>
        {cards.length === 0 && <p className="muted">暂无通知。</p>}
        {cards.map((c) => (
          <p key={c.approval_id} className="muted">
            [{approvalStatusLabel(c.status)}] {c.assignee} · {stripApprovalRecordIds(c.body)}
          </p>
        ))}
      </section>
    </div>
  );
}
