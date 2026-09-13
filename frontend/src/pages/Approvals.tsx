import { useEffect, useMemo, useState, type FormEvent } from "react";
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

type Preview = {
  steps: { name: string; role: string }[];
  plan?: { rule_id?: string; amount_base?: number; currency?: string; amount?: number };
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
    <div className="list-page approval-page" data-visual="docs20">
      <div>
        <div className="page-kicker">审批</div>
        <h1 style={{ marginTop: 0 }}>工作审批</h1>
        <p className="muted">费用按规则一位通过再到下一位。最后一位同意即办结；任一位驳回则整单作废。「待我处理」只列出轮到你确认的单；还没轮到时可在「待处理」查看。</p>
      </div>
      <InitiateExpenseForm
        onCreated={(id) => {
          setErr("");
          setSearchParams({ id });
          load();
        }}
      />
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
